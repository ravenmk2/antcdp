//go:build linux

package workspacefs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"strings"
	"syscall"
	"time"
)

type SecurityChecks struct {
	WorkloadUID               int  `json:"workload_uid"`
	CommandDenied             bool `json:"command_denied"`
	InitializationDenied      bool `json:"initialization_denied"`
	TransferPrivate           bool `json:"transfer_private"`
	HelperImmutable           bool `json:"helper_immutable"`
	ControlEnvironmentPrivate bool `json:"control_environment_private"`
	CredentialsAbsent         bool `json:"credentials_absent"`
}

// WorkloadProbe runs only as the fixed unprivileged workload identity. It tries
// bounded, harmless control calls in its own sandbox; it never sends a token.
func WorkloadProbe(ctx context.Context) SecurityChecks {
	checks := SecurityChecks{WorkloadUID: os.Geteuid(), CredentialsAbsent: true}
	for _, name := range []string{"EXECD_ACCESS_TOKEN", "EXECD_ENVD_ACCESS_TOKEN", "OPEN_SANDBOX_API_KEY", "ANTCDP_MASTER_KEY"} {
		if os.Getenv(name) != "" {
			checks.CredentialsAbsent = false
		}
	}
	if f, err := os.Open(TransferDirectory); err != nil {
		checks.TransferPrivate = os.IsPermission(err)
	} else {
		_ = f.Close()
	}
	if f, err := os.OpenFile(HelperPath, os.O_WRONLY, 0); err != nil {
		checks.HelperImmutable = os.IsPermission(err) || errors.Is(err, syscall.EROFS)
	} else {
		_ = f.Close()
	}
	if f, err := os.Open("/proc/1/environ"); err != nil {
		checks.ControlEnvironmentPrivate = os.IsPermission(err)
	} else {
		_ = f.Close()
	}
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 3 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	denied := func(endpoint, body string) bool {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, "http://127.0.0.1:44772"+endpoint, strings.NewReader(body))
		if err != nil {
			return false
		}
		req.Header.Set("Content-Type", "application/json")
		res, err := client.Do(req)
		if err != nil {
			return false
		} // A missing/broken control process is not proof of isolation.
		defer func() { _ = res.Body.Close() }()
		_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 16<<10))
		return res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden
	}
	checks.CommandDenied = denied("/command", `{"command":"id -u","uid":0,"gid":0,"timeout":1000}`)
	// Deliberately invalid JSON cannot initialize or mutate an unprotected
	// server. A secure control API rejects it before parsing the body.
	checks.InitializationDenied = denied("/internal/init", `{`)
	return checks
}

func (e *Engine) verifySecurity(ctx context.Context) Response {
	if os.Geteuid() != 0 || e.UID != 10001 || e.GID != 10001 || e.WorkspaceRoot != "/data" || e.TransferRoot != TransferDirectory {
		return Result(nil, false, failure("WORKSPACE_SECURITY_UNVERIFIED"))
	}
	info, err := os.Lstat(HelperPath)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0022 != 0 {
		return Result(nil, false, failure("WORKSPACE_HELPER_UNSAFE"))
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 {
		return Result(nil, false, failure("WORKSPACE_HELPER_UNSAFE"))
	}
	if !immutableHelperParents("/", HelperPath, 0) {
		return Result(nil, false, failure("WORKSPACE_HELPER_UNSAFE"))
	}
	capability := e.capabilities()
	if !capability.OK {
		return capability
	}
	command := exec.CommandContext(ctx, HelperPath, "--workload-probe")
	command.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 10001, Gid: 10001, Groups: []uint32{}}}
	command.Dir = "/data"
	var output bytes.Buffer
	command.Stdout = &output
	if err = command.Run(); err != nil || output.Len() > 8192 {
		return Result(nil, false, failure("WORKSPACE_SECURITY_UNVERIFIED"))
	}
	var checks SecurityChecks
	if json.Unmarshal(output.Bytes(), &checks) != nil {
		return Result(nil, false, failure("WORKSPACE_SECURITY_UNVERIFIED"))
	}
	if checks.WorkloadUID != 10001 || !checks.CommandDenied || !checks.InitializationDenied || !checks.TransferPrivate || !checks.HelperImmutable || !checks.ControlEnvironmentPrivate || !checks.CredentialsAbsent {
		return Response{Version: Version, OK: false, Code: "WORKSPACE_CONTROL_PLANE_UNSAFE", Result: json.RawMessage(output.Bytes())}
	}
	return Result(checks, false, nil)
}

// File mode alone does not prevent replacement through a writable parent.
// Production always walks from / with UID 0; the explicit root permits a
// filesystem fixture without requiring tests to modify system directories.
func immutableHelperParents(root, helper string, owner uint32) bool {
	root, helper = path.Clean(root), path.Clean(helper)
	if !path.IsAbs(root) || !path.IsAbs(helper) || helper == root || root != "/" && !strings.HasPrefix(helper, root+"/") {
		return false
	}
	for parent := path.Dir(helper); ; parent = path.Dir(parent) {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() || info.Mode().Perm()&0022 != 0 {
			return false
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != owner {
			return false
		}
		if parent == root {
			return true
		}
		if parent == "/" {
			return false
		}
	}
}
