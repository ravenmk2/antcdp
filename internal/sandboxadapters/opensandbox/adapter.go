// Package opensandbox implements the Docker provider through explicit low-level
// lifecycle and execd calls. It never retries mutations or deletes on failure.
package opensandbox

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

const (
	installationKey = "antcdp_installation_id"
	workspaceKey    = "antcdp_cloud_computer_id"
	creationKey     = "antcdp_creation_token"
	execdPort       = 44772
)

type Factory struct{}

var _ sandboxcore.Factory = Factory{}
var _ sandboxcore.Provider = (*Provider)(nil)

type Provider struct {
	connection sandboxcore.Connection
	base       *url.URL
	lifecycle  *sdk.LifecycleClient
	http       *http.Client
}

func (Factory) Open(ctx context.Context, c sandboxcore.Connection) (sandboxcore.Provider, error) {
	if err := ctx.Err(); err != nil {
		return nil, remoteError(err, false)
	}
	base, err := connectionURL(c.Endpoint)
	if err != nil {
		return nil, err
	}
	if c.AccessMode == "" {
		c.AccessMode = "direct"
	}
	if c.ConnectTimeout == 0 {
		c.ConnectTimeout = 10 * time.Second
	}
	if c.OperationTimeout == 0 {
		c.OperationTimeout = 300 * time.Second
	}
	if c.AccessMode != "direct" && c.AccessMode != "server_proxy" || c.ConnectTimeout < time.Second || c.ConnectTimeout > 30*time.Second || c.OperationTimeout < 10*time.Second || c.OperationTimeout > 600*time.Second || len(c.APIKey) == 0 || len(c.APIKey) > 8192 || strings.ContainsAny(c.APIKey, "\r\n") {
		return nil, failure("SANDBOX_CONNECTION_INVALID", false)
	}
	transport := &http.Transport{DialContext: (&net.Dialer{Timeout: c.ConnectTimeout, KeepAlive: 30 * time.Second}).DialContext,
		TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: c.ConnectTimeout,
		ResponseHeaderTimeout: c.ConnectTimeout, MaxResponseHeaderBytes: 64 << 10, IdleConnTimeout: 30 * time.Second,
		MaxIdleConns: 16, MaxIdleConnsPerHost: 4, ForceAttemptHTTP2: true}
	client := &http.Client{Transport: boundedTransport{base: transport}, Timeout: c.OperationTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	c.ControlKey = append([]byte(nil), c.ControlKey...)
	return &Provider{connection: c, base: base, http: client, lifecycle: sdk.NewLifecycleClientWithCache(strings.TrimRight(base.String(), "/")+"/v1", c.APIKey, nil, sdk.WithHTTPClient(client))}, nil
}

func connectionURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 || u == nil || u.Scheme != "http" && u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.ContainsAny(raw, "\r\n\\") || u.Opaque != "" {
		return nil, failure("SANDBOX_CONNECTION_INVALID", false)
	}
	if port := u.Port(); port != "" {
		n, e := strconv.Atoi(port)
		if e != nil || n < 1 || n > 65535 {
			return nil, failure("SANDBOX_CONNECTION_INVALID", false)
		}
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return u, nil
}

func (p *Provider) Create(ctx context.Context, s sandboxcore.CreateSpec) (sandboxcore.Observation, error) {
	if err := validateCreate(s); err != nil {
		return sandboxcore.Observation{}, err
	}
	token, err := p.controlToken(s.Ownership)
	if err != nil {
		return sandboxcore.Observation{}, err
	}
	request := sdk.CreateSandboxRequest{Image: &sdk.ImageSpec{URI: s.Config.Environment.Image},
		Env:            map[string]string{"EXECD_ACCESS_TOKEN": token},
		ResourceLimits: sdk.ResourceLimits{"cpu": fmt.Sprintf("%dm", s.Config.Environment.CPUMillicores), "memory": fmt.Sprintf("%dMi", s.Config.Environment.MemoryMiB)},
		Metadata:       metadata(s.Ownership), Entrypoint: []string{"tail", "-f", "/dev/null"},
		NetworkPolicy: &sdk.NetworkPolicy{DefaultAction: s.Network.ProviderPolicy.DefaultAction, Egress: []sdk.NetworkRule{}}}
	if s.Lifetime > 0 {
		seconds := int((s.Lifetime + time.Second - 1) / time.Second)
		request.Timeout = &seconds
	}
	for _, r := range s.Network.ProviderPolicy.Egress {
		request.NetworkPolicy.Egress = append(request.NetworkPolicy.Egress, sdk.NetworkRule{Action: r.Action, Target: r.Target})
	}
	if s.Mount.Kind == "named_volume" {
		create, deleteOnTermination := s.Mount.CreateIfMissing, false
		request.Volumes = []sdk.Volume{{Name: "data", PVC: &sdk.PVC{ClaimName: s.Mount.VolumeName, CreateIfNotExists: &create, DeleteOnSandboxTermination: &deleteOnTermination}, MountPath: "/data"}}
		request.Metadata["antcdp_volume_id"] = s.Mount.VolumeID
	}
	result, err := p.lifecycle.CreateSandbox(ctx, request)
	if err != nil {
		return sandboxcore.Observation{}, remoteError(err, true)
	}
	ref := sandboxcore.ResourceRef{BackendGeneration: s.BackendGeneration, Ownership: s.Ownership}
	if result != nil {
		ref.RemoteID = result.ID
	}
	out := sandboxcore.Observation{Ref: ref, State: "unknown"}
	if result == nil || !validRemoteID(ref.RemoteID) {
		return out, failure("SANDBOX_RESPONSE_INVALID", true)
	}
	// Preserve an acquired remote ID even if ownership/state validation fails.
	out, err = observe(ref, result)
	if err != nil {
		return out, failure("SANDBOX_OWNERSHIP_MISMATCH", true)
	}
	return out, nil
}

func (p *Provider) Inspect(ctx context.Context, ref sandboxcore.ResourceRef) (sandboxcore.Observation, error) {
	if err := validateRef(ref); err != nil {
		return sandboxcore.Observation{}, err
	}
	result, err := p.lifecycle.GetSandbox(ctx, ref.RemoteID)
	if statusCode(err) == http.StatusNotFound {
		return sandboxcore.Observation{Ref: ref, State: "absent"}, nil
	}
	if err != nil {
		return sandboxcore.Observation{Ref: ref, State: "unknown"}, remoteError(err, false)
	}
	return observe(ref, result)
}

func (p *Provider) Find(ctx context.Context, owner sandboxcore.Ownership, page, size int) (sandboxcore.ResourcePage, error) {
	if !validOwner(owner) || page < 1 || size < 1 || size > 100 {
		return sandboxcore.ResourcePage{}, failure("SANDBOX_REQUEST_INVALID", false)
	}
	result, err := p.lifecycle.ListSandboxes(ctx, sdk.ListOptions{Metadata: metadata(owner), Page: page, PageSize: size})
	if err != nil {
		return sandboxcore.ResourcePage{}, remoteError(err, false)
	}
	if result == nil || result.Pagination.Page != page || result.Pagination.PageSize != size || len(result.Items) > size || result.Pagination.TotalItems < 0 || result.Pagination.TotalPages < 0 || result.Pagination.HasNextPage != (page < result.Pagination.TotalPages) {
		return sandboxcore.ResourcePage{}, failure("SANDBOX_RESPONSE_INVALID", false)
	}
	out := sandboxcore.ResourcePage{Items: []sandboxcore.Observation{}, HasMore: result.Pagination.HasNextPage}
	for i := range result.Items {
		item := &result.Items[i]
		ref := sandboxcore.ResourceRef{RemoteID: item.ID, Ownership: owner}
		observed, err := observe(ref, item)
		// An ignored/misimplemented metadata filter is a failed lookup, never
		// permission to adopt or clean another platform's resources.
		if err != nil {
			return sandboxcore.ResourcePage{}, err
		}
		out.Items = append(out.Items, observed)
	}
	return out, nil
}

func (p *Provider) Terminate(ctx context.Context, ref sandboxcore.ResourceRef) error {
	observed, err := p.Inspect(ctx, ref)
	if err != nil {
		return err
	}
	if observed.State == "absent" || observed.State == "terminated" {
		return nil
	}
	return remoteError(p.lifecycle.DeleteSandbox(ctx, ref.RemoteID), true)
}

func (p *Provider) Pause(ctx context.Context, ref sandboxcore.ResourceRef) error {
	actual, e := p.Inspect(ctx, ref)
	if e != nil {
		return e
	}
	if actual.State == "paused" {
		return nil
	}
	if actual.State != "ready" {
		return failure("SANDBOX_NOT_READY", false)
	}
	return remoteError(p.lifecycle.PauseSandbox(ctx, ref.RemoteID), true)
}
func (p *Provider) Resume(ctx context.Context, ref sandboxcore.ResourceRef) error {
	actual, e := p.Inspect(ctx, ref)
	if e != nil {
		return e
	}
	if actual.State == "ready" {
		return nil
	}
	if actual.State != "paused" {
		return failure("SANDBOX_NOT_PAUSED", false)
	}
	return remoteError(p.lifecycle.ResumeSandbox(ctx, ref.RemoteID), true)
}

func (p *Provider) Health(ctx context.Context, ref *sandboxcore.ResourceRef) error {
	if ref == nil {
		_, err := p.lifecycle.ListSandboxes(ctx, sdk.ListOptions{Page: 1, PageSize: 1})
		return remoteError(err, false)
	}
	client, err := p.execd(ctx, *ref)
	if err != nil {
		return err
	}
	return remoteError(client.Ping(ctx), false)
}

func (p *Provider) execd(ctx context.Context, ref sandboxcore.ResourceRef) (*sdk.ExecdClient, error) {
	endpoint, err := p.dataEndpoint(ctx, ref)
	if err != nil {
		return nil, err
	}
	return sdk.NewExecdClient(endpoint.Endpoint, "", sdk.WithHTTPClient(p.http), sdk.WithHeaders(endpoint.Headers)), nil
}

func (p *Provider) dataEndpoint(ctx context.Context, ref sandboxcore.ResourceRef) (*sdk.Endpoint, error) {
	token, err := p.controlToken(ref.Ownership)
	if err != nil {
		return nil, err
	}
	observed, err := p.Inspect(ctx, ref)
	if err != nil {
		return nil, err
	}
	if observed.State != "ready" {
		return nil, failure("SANDBOX_NOT_READY", false)
	}
	proxy := p.connection.AccessMode == "server_proxy"
	endpoint, err := p.lifecycle.GetEndpoint(ctx, ref.RemoteID, execdPort, &proxy)
	if err != nil {
		return nil, remoteError(err, false)
	}
	if endpoint == nil {
		return nil, failure("SANDBOX_ENDPOINT_INVALID", false)
	}
	raw := endpoint.Endpoint
	if strings.HasPrefix(raw, "/") {
		raw = p.base.Scheme + "://" + p.base.Host + raw
	} else if !strings.Contains(raw, "://") {
		raw = p.base.Scheme + "://" + raw
	}
	u, err := connectionURL(raw)
	if err != nil {
		return nil, failure("SANDBOX_ENDPOINT_INVALID", false)
	}
	if proxy && (u.Scheme != p.base.Scheme || !strings.EqualFold(u.Host, p.base.Host) || !strings.HasPrefix(u.Path, strings.TrimRight(p.base.Path, "/")+"/v1/sandboxes/"+ref.RemoteID+"/proxy/")) {
		return nil, failure("SANDBOX_ENDPOINT_INVALID", false)
	}
	headers := map[string]string{}
	for name, value := range endpoint.Headers {
		if len(value) > 8192 || strings.ContainsAny(value, "\r\n") {
			return nil, failure("SANDBOX_ENDPOINT_INVALID", false)
		}
		// Docker needs only the sandbox-scoped token. Never forward arbitrary
		// headers or the server credential supplied by a remote endpoint.
		if !strings.EqualFold(name, "X-EXECD-ACCESS-TOKEN") {
			return nil, failure("SANDBOX_ENDPOINT_INVALID", false)
		}
		if !hmac.Equal([]byte(value), []byte(token)) {
			return nil, failure("SANDBOX_CONTROL_IDENTITY_MISMATCH", false)
		}
	}
	headers["X-EXECD-ACCESS-TOKEN"] = token
	if proxy {
		headers["OPEN-SANDBOX-API-KEY"] = p.connection.APIKey
	}
	return &sdk.Endpoint{Endpoint: u.String(), Headers: headers}, nil
}

// This versioned domain and ownership tuple must remain stable across process
// restarts and provider API key rotation. No secret is stored in metadata.
func (p *Provider) controlToken(owner sandboxcore.Ownership) (string, error) {
	if len(p.connection.ControlKey) != 32 || !validOwner(owner) {
		return "", failure("SANDBOX_CONTROL_KEY_UNAVAILABLE", false)
	}
	mac := hmac.New(sha256.New, p.connection.ControlKey)
	_, _ = fmt.Fprintf(mac, "antcdp/sandbox-execd/v1\x00%s\x00%d\x00%s", owner.InstallationID, owner.ComputerID, owner.CreationToken)
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func validateCreate(s sandboxcore.CreateSpec) error {
	if s.BackendGeneration == 0 || !validOwner(s.Ownership) || s.Config.RuntimeBackend != "docker" || s.Lifetime < 0 || s.Lifetime > 24*time.Hour || s.Lifetime > 0 && s.Lifetime < time.Minute || s.Mount.MountPath != "/data" {
		return failure("SANDBOX_REQUEST_INVALID", false)
	}
	e := s.Config.Environment
	if len(e.Image) < 1 || len(e.Image) > 512 || strings.ContainsAny(e.Image, " \t\r\n") || strings.HasSuffix(e.Image, ":latest") || (!strings.Contains(e.Image, "@sha256:") && !strings.Contains(e.Image[strings.LastIndex(e.Image, "/")+1:], ":")) || e.CPUMillicores < 100 || e.CPUMillicores > 32000 || e.MemoryMiB < 128 || e.MemoryMiB > 65536 {
		return failure("SANDBOX_REQUEST_INVALID", false)
	}
	if s.Mount.Kind == "named_volume" {
		if !lowerHex32(s.Mount.VolumeID) || s.Mount.VolumeName != "acdp-"+s.Ownership.InstallationID[:8]+"-"+s.Mount.VolumeID {
			return failure("SANDBOX_VOLUME_INVALID", false)
		}
	} else if s.Mount.Kind != "ephemeral" || s.Mount.VolumeID != "" || s.Mount.VolumeName != "" || s.Mount.CreateIfMissing {
		return failure("SANDBOX_VOLUME_INVALID", false)
	}
	return sandboxcore.ValidateCompilation(s.Network, s.Config.Network)
}

func validateRef(r sandboxcore.ResourceRef) error {
	if !validOwner(r.Ownership) || !validRemoteID(r.RemoteID) {
		return failure("SANDBOX_REQUEST_INVALID", false)
	}
	return nil
}

func validRemoteID(id string) bool {
	if len(id) < 1 || len(id) > 200 {
		return false
	}
	for _, c := range id {
		valid := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_'
		if !valid {
			return false
		}
	}
	return true
}
func lowerHex32(v string) bool {
	if len(v) != 32 {
		return false
	}
	for _, c := range v {
		valid := c >= 'a' && c <= 'f' || c >= '0' && c <= '9'
		if !valid {
			return false
		}
	}
	return true
}
func validOwner(o sandboxcore.Ownership) bool {
	return lowerHex32(o.InstallationID) && o.ComputerID > 0 && lowerHex32(o.CreationToken)
}
func metadata(o sandboxcore.Ownership) map[string]string {
	return map[string]string{installationKey: o.InstallationID, workspaceKey: strconv.FormatUint(o.ComputerID, 10), creationKey: o.CreationToken}
}
func observe(ref sandboxcore.ResourceRef, info *sdk.SandboxInfo) (sandboxcore.Observation, error) {
	out := sandboxcore.Observation{Ref: ref, State: "unknown"}
	if info == nil || !validRemoteID(info.ID) || info.ID != ref.RemoteID {
		return out, failure("SANDBOX_RESPONSE_INVALID", false)
	}
	for k, v := range metadata(ref.Ownership) {
		if info.Metadata[k] != v {
			return out, failure("SANDBOX_OWNERSHIP_MISMATCH", false)
		}
	}
	out.ExpiresAt = info.ExpiresAt
	switch info.Status.State {
	case sdk.StatePending:
		out.State = "starting"
	case sdk.StateRunning:
		out.State = "ready"
	case sdk.StateTerminated:
		out.State = "terminated"
	case sdk.StatePaused:
		out.State = "paused"
	case sdk.StatePausing:
		out.State = "pausing"
	case sdk.StateFailed:
		out.State = "unhealthy"
	}
	return out, nil
}
func failure(code string, unknown bool) error {
	return &sandboxcore.Error{Code: code, Unknown: unknown}
}
func statusCode(err error) int {
	var remote *sdk.APIError
	if errors.As(err, &remote) {
		return remote.StatusCode
	}
	return 0
}
func remoteError(err error, mutation bool) error {
	if err == nil {
		return nil
	}
	var own *sandboxcore.Error
	if errors.As(err, &own) {
		return &sandboxcore.Error{Code: own.Code, Unknown: own.Unknown || mutation}
	}
	code, unknown := "SANDBOX_UNAVAILABLE", mutation
	switch statusCode(err) {
	case 400, 405, 409, 415, 422:
		code = "SANDBOX_REMOTE_REJECTED"
		unknown = false
	case 401, 403:
		code = "SANDBOX_AUTHENTICATION_FAILED"
		unknown = false
	case 404:
		code = "SANDBOX_REMOTE_NOT_FOUND"
		unknown = false
	case 429:
		code = "SANDBOX_RATE_LIMITED"
		unknown = false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		code = "SANDBOX_OPERATION_TIMEOUT"
	}
	if errors.Is(err, context.Canceled) {
		code = "SANDBOX_OPERATION_CANCELLED"
	}
	// Deliberately do not retain an SDK error, URL, header, response body or
	// arbitrary remote message in an error that can cross the host boundary.
	return failure(code, unknown)
}
