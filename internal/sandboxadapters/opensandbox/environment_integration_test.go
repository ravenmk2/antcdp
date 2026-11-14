package opensandbox

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/workspacefs"
)

func integrationConnection(t *testing.T, mode string) (sandboxcore.Connection, string) {
	t.Helper()
	endpoint := os.Getenv("ANTCDP_TEST_OPENSANDBOX_ENDPOINT")
	if endpoint == "" {
		t.Skip("ANTCDP_TEST_OPENSANDBOX_ENDPOINT not configured")
	}
	key, image := os.Getenv("ANTCDP_TEST_OPENSANDBOX_API_KEY"), os.Getenv("ANTCDP_TEST_OPENSANDBOX_IMAGE")
	control, err := hex.DecodeString(os.Getenv("ANTCDP_TEST_OPENSANDBOX_CONTROL_KEY_HEX"))
	if key == "" || image == "" || err != nil || len(control) < 32 {
		t.Fatal("private integration fixture is incomplete")
	}
	return sandboxcore.Connection{Endpoint: endpoint, APIKey: key, ControlKey: control, AccessMode: mode, ConnectTimeout: 10 * time.Second, OperationTimeout: 90 * time.Second}, image
}

func integrationSpec(t *testing.T, image string, policy sandboxcore.NetworkPolicy) sandboxcore.CreateSpec {
	t.Helper()
	snapshot, err := sandboxcore.SnapshotPolicy(policy)
	if err != nil {
		t.Fatal(err)
	}
	compiled, err := sandboxcore.CompilePolicy(snapshot, nil)
	if err != nil {
		t.Fatal(err)
	}
	return sandboxcore.CreateSpec{BackendGeneration: 1, Ownership: sandboxcore.Ownership{InstallationID: integrationToken(t), ComputerID: 1, CreationToken: integrationToken(t)}, Config: sandboxcore.EffectiveConfig{RuntimeBackend: "docker", Environment: sandboxcore.Environment{Image: image, CPUMillicores: 1000, MemoryMiB: 1024}, Network: snapshot}, Network: compiled, Mount: sandboxcore.MountPlan{Kind: "ephemeral", MountPath: "/data"}, Lifetime: 5 * time.Minute}
}

func integrationResource(t *testing.T, ctx context.Context, provider sandboxcore.Provider, spec sandboxcore.CreateSpec) (sandboxcore.ResourceRef, func() bool) {
	t.Helper()
	// These are non-secret, unique ownership facts needed for independently
	// verifying cleanup after an interrupted process or an unknown Create.
	t.Logf("resource intent installation=%s workspace=%d creation=%s", spec.Ownership.InstallationID, spec.Ownership.ComputerID, spec.Ownership.CreationToken)
	created, err := provider.Create(ctx, spec)
	ref := created.Ref
	if err != nil && ref.RemoteID == "" {
		found, findErr := provider.Find(ctx, spec.Ownership, 1, 100)
		if findErr == nil && !found.HasMore && len(found.Items) == 1 {
			ref = found.Items[0].Ref
			ref.BackendGeneration = spec.BackendGeneration
		}
	}
	attempted, confirmed := false, false
	terminate := func() bool {
		if attempted || ref.RemoteID == "" {
			return confirmed
		}
		attempted = true
		cleanup, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		deleteErr := provider.Terminate(cleanup, ref)
		for {
			observed, inspectErr := provider.Inspect(cleanup, ref)
			if inspectErr == nil && (observed.State == "absent" || observed.State == "terminated") {
				confirmed = true
				return true
			}
			if !integrationWait(cleanup) {
				t.Errorf("cleanup unconfirmed resource=%s terminate=%v inspect=%v", ref.RemoteID, deleteErr, inspectErr)
				return false
			}
		}
	}
	t.Cleanup(func() { terminate() })
	if err != nil || ref.RemoteID == "" {
		t.Fatal("resource creation not repeated:", err)
	}
	t.Logf("ephemeral-or-owned resource=%s", ref.RemoteID)
	for {
		observed, err := provider.Inspect(ctx, ref)
		if err != nil {
			t.Fatal("inspect resource:", err)
		}
		if observed.State == "ready" {
			break
		}
		if observed.State == "terminated" || observed.State == "absent" || !integrationWait(ctx) {
			t.Fatal("resource did not become ready")
		}
	}
	if err := provider.Health(ctx, &ref); err != nil {
		t.Fatal("data-plane unavailable:", err)
	}
	return ref, terminate
}

// The additional switch explicitly accepts creating retained named volumes.
// Their exact names are logged, but this provider has no volume deletion API.
// The authorized deployment fixture must verify ownership before removing them.
func TestOpenSandboxPersistentWorkspaceIntegration(t *testing.T) {
	if os.Getenv("ANTCDP_TEST_OPENSANDBOX_PERSISTENCE") != "1" {
		t.Skip("named-volume integration not enabled")
	}
	for _, mode := range integrationAccessModes(t) {
		t.Run(mode, func(t *testing.T) {
			connection, image := integrationConnection(t, mode)
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			provider, err := (Factory{}).Open(ctx, connection)
			if err != nil {
				t.Fatal(err)
			}
			spec := integrationSpec(t, image, sandboxcore.DefaultPolicy())
			volumeID := integrationToken(t)
			volumeName := "acdp-" + spec.Ownership.InstallationID[:8] + "-" + volumeID
			spec.Mount = sandboxcore.MountPlan{Kind: "named_volume", MountPath: "/data", VolumeID: volumeID, VolumeName: volumeName, CreateIfMissing: true}
			t.Logf("retained test volume=%s volume_id=%s", volumeName, volumeID)
			first, stop := integrationResource(t, ctx, provider, spec)
			integrationHelper(t, ctx, provider, first, workspacefs.Request{Operation: "verify_security"})
			integrationHelper(t, ctx, provider, first, workspacefs.Request{Operation: "initialize", AgentID: "1", ProjectID: "1"})
			content := []byte("retained workspace evidence:" + integrationToken(t))
			path := "projects/1/persisted.txt"
			integrationHelper(t, ctx, provider, first, workspacefs.Request{Operation: "write", Path: path, Data: base64.StdEncoding.EncodeToString(content)})
			if !stop() {
				t.Fatal("original instance remains unknown; volume must not be remounted")
			}
			spec.Ownership.CreationToken = integrationToken(t)
			spec.Mount.CreateIfMissing = false
			second, stopSecond := integrationResource(t, ctx, provider, spec)
			if second.RemoteID == first.RemoteID {
				t.Fatal("persistence test did not replace the instance")
			}
			integrationHelper(t, ctx, provider, second, workspacefs.Request{Operation: "verify_security"})
			integrationRead(t, ctx, provider, second, path, content)
			if !stopSecond() {
				t.Fatal("replacement instance cleanup unconfirmed")
			}
		})
	}
}

// Network targets are a private, controlled HTTP fixture. The internal target
// must use a literal RFC1918/ULA address. A simultaneously live allow instance
// checks reachability before and after each denied request, so an unavailable
// target cannot masquerade as successful enforcement. Target URLs are not logged.
func TestOpenSandboxNetworkPolicyIntegration(t *testing.T) {
	public := os.Getenv("ANTCDP_TEST_OPENSANDBOX_PUBLIC_PROBE_URL")
	internal := os.Getenv("ANTCDP_TEST_OPENSANDBOX_INTERNAL_PROBE_URL")
	if public == "" || internal == "" {
		t.Skip("controlled network targets not configured")
	}
	privateURL, err := url.Parse(internal)
	if err != nil || !integrationProbeURL(privateURL) {
		t.Fatal("invalid internal probe URL")
	}
	address, err := netip.ParseAddr(privateURL.Hostname())
	if err != nil || !address.IsPrivate() || address.Zone() != "" {
		t.Fatal("internal probe must use a private literal IP")
	}
	publicURL, err := url.Parse(public)
	if err != nil || !integrationProbeURL(publicURL) {
		t.Fatal("invalid public probe URL")
	}
	if ip, err := netip.ParseAddr(publicURL.Hostname()); err == nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || !ip.IsGlobalUnicast()) {
		t.Fatal("public probe must be outside private/local ranges")
	}
	for _, mode := range integrationAccessModes(t) {
		t.Run(mode, func(t *testing.T) {
			integrationNetworkPolicy(t, mode, public, internal, address)
		})
	}
}

func integrationNetworkPolicy(t *testing.T, mode, public, internal string, address netip.Addr) {
	t.Helper()
	connection, image := integrationConnection(t, mode)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	provider, err := (Factory{}).Open(ctx, connection)
	if err != nil {
		t.Fatal(err)
	}
	allow := sandboxcore.DefaultPolicy()
	allow.AllowTargets = []string{address.Unmap().String()}
	control, stopControl := integrationResource(t, ctx, provider, integrationSpec(t, image, allow))
	for _, target := range []string{public, internal} {
		if integrationNetworkExit(t, ctx, provider, control, target) != 0 {
			t.Fatal("positive-control target is not reachable; enforcement is unverified")
		}
	}
	for _, name := range []string{"preset_private_deny", "explicit_deny_over_allow"} {
		t.Run(name, func(t *testing.T) {
			policy := sandboxcore.DefaultPolicy()
			if name == "explicit_deny_over_allow" {
				policy.AllowTargets = []string{address.Unmap().String()}
				policy.DenyTargets = []string{address.Unmap().String()}
			}
			ref, stop := integrationResource(t, ctx, provider, integrationSpec(t, image, policy))
			if integrationNetworkExit(t, ctx, provider, control, internal) != 0 || integrationNetworkExit(t, ctx, provider, ref, public) != 0 {
				t.Fatal("positive reachability control failed; deny cannot be assessed")
			}
			denied := integrationNetworkExit(t, ctx, provider, ref, internal)
			if denied == 0 {
				t.Fatal("private destination bypassed the deny policy")
			}
			if denied != 7 && denied != 28 {
				t.Fatal("target returned a non-network failure; deny is unverified")
			}
			if integrationNetworkExit(t, ctx, provider, control, internal) != 0 {
				t.Fatal("target stopped responding; deny result is inconclusive")
			}
			if !stop() {
				t.Fatal("network test instance cleanup unconfirmed")
			}
		})
	}
	if !stopControl() {
		t.Fatal("positive-control instance cleanup unconfirmed")
	}
}

func integrationProbeURL(u *url.URL) bool {
	return u != nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && u.Fragment == "" && !strings.ContainsAny(u.String(), "\r\n\x00")
}
func integrationNetworkExit(t *testing.T, ctx context.Context, p sandboxcore.Provider, ref sandboxcore.ResourceRef, target string) int32 {
	t.Helper()
	uid := uint32(10001)
	var handle *sandboxcore.ExecutionHandle
	_, err := p.Exec(ctx, ref, sandboxcore.ExecSpec{Argv: []string{"/usr/bin/curl", "--fail", "--silent", "--connect-timeout", "3", "--max-time", "8", "--noproxy", "*", "--output", "/dev/null", target}, CWD: "/data", UID: &uid, GID: &uid, Background: true, Timeout: 12 * time.Second, MaxOutputBytes: 1024}, sandboxcore.ExecCallbacks{Started: func(_ context.Context, h sandboxcore.ExecutionHandle) error { handle = &h; return nil }})
	if err != nil || handle == nil {
		t.Fatal("network probe command unavailable:", err)
	}
	bounded, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	for {
		result, err := p.InspectExecution(bounded, *handle)
		if err != nil {
			t.Fatal("network probe status unavailable:", err)
		}
		if !result.Running && result.ExitCode != nil {
			return *result.ExitCode
		}
		if !integrationWait(bounded) {
			t.Fatal("network probe process did not settle; result is unverified")
		}
	}
}
