package app

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/agents"
	c "github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/integrations"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

//go:embed git_repo_init.sh
var initGitScript string

//go:embed git_credentials.sh
var gitCredentialScript string

type gitPlatformAPI struct {
	integrations *integrations.Service
	sandbox      *agents.CloudService
	// The sandbox also fences staged files by request ID before publication.
	credentialLocks [64]sync.Mutex
}

func (g *gitPlatformAPI) list(ctx context.Context, x agentcore.ExecutionContext, _ agentcore.ID, raw json.RawMessage) (json.RawMessage, error) {
	args := struct {
		Code string `json:"project_code"`
		Page int    `json:"page"`
		Size int    `json:"page_size"`
	}{Page: 1, Size: 20}
	if err := json.Unmarshal(raw, &args); err != nil {
		return nil, httpx.Invalid("args", "invalid_format")
	}
	result, err := g.integrations.AgentRepoList(ctx, x.Authorization, args.Code, integrations.RepoQuery{Page: args.Page, Size: args.Size})
	if err != nil {
		return nil, err
	}
	return json.Marshal(result)
}

type gitSandbox struct {
	*agents.SandboxAccess
	cloud  *agents.CloudService
	callID uint64
}

func (a *gitSandbox) checkpoint(ctx context.Context, command string) error {
	return a.cloud.RecordPAPIStep(ctx, a.SandboxAccess, a.callID, command)
}

func (g *gitPlatformAPI) withComputer(ctx context.Context, x agentcore.ExecutionContext, call agentcore.ID, run func(*gitSandbox) (json.RawMessage, error)) (json.RawMessage, error) {
	a, err := g.sandbox.AcquireExecutionComputer(ctx, x.Ref, uint64(call), "tool_call", strconv.FormatUint(uint64(call), 10))
	if err != nil {
		return nil, err
	}
	result, cause := run(&gitSandbox{SandboxAccess: a, cloud: g.sandbox, callID: uint64(call)})
	finish, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	var remote *sandboxcore.Error
	if errors.As(cause, &remote) && remote.Unknown {
		err = g.sandbox.MarkReferencesUnknown(finish, a, "git_operation_unknown", json.RawMessage(`{"physical_completion_verified":false}`))
	} else {
		err = g.sandbox.ReleaseReferences(finish, a, json.RawMessage(`{"physical_completion_verified":true}`))
	}
	if err != nil {
		return nil, &sandboxcore.Error{Code: "GIT_OPERATION_OUTCOME_UNKNOWN", Unknown: true}
	}
	return result, cause
}

func gitProcess(ctx context.Context, a *gitSandbox, root bool, args ...string) (int, string, error) {
	spec := sandboxcore.ExecSpec{Argv: args, CWD: "/", Timeout: 30 * time.Second, MaxOutputBytes: 8192}
	if root {
		var zero uint32
		spec.UID = &zero
		spec.GID = &zero
	}
	if err := a.checkpoint(ctx, ""); err != nil {
		return 0, "", err
	}
	var output strings.Builder
	res, err := a.Provider.Exec(ctx, a.Resource, spec, sandboxcore.ExecCallbacks{Started: func(c context.Context, h sandboxcore.ExecutionHandle) error {
		if h.Resource != a.Resource || h.ID == "" {
			return errors.New("invalid sandbox execution handle")
		}
		return a.checkpoint(c, h.ID)
	}, Output: func(_ context.Context, v sandboxcore.Output) error {
		if v.Stream == "stdout" {
			output.WriteString(v.Text)
		}
		return nil
	}})
	if err != nil {
		return 0, "", err
	}
	if res.Running || res.ExitCode == nil {
		return 0, "", &sandboxcore.Error{Code: "GIT_OPERATION_OUTCOME_UNKNOWN", Unknown: true}
	}
	return int(*res.ExitCode), strings.TrimSuffix(output.String(), "\n"), nil
}

func gitExit(status int) error {
	switch status {
	case 0:
		return nil
	case 41:
		return httpx.E(409, "GIT_WORKTREE_CONFLICT", "目标路径已占用或仓库配置不匹配")
	case 42:
		return httpx.E(409, "CREDENTIAL_TMPFS_UNAVAILABLE", "沙箱凭证临时文件系统不可用")
	case 44:
		return httpx.E(409, "SANDBOX_GIT_UNAVAILABLE", "沙箱中没有 Git")
	case 45:
		return httpx.E(409, "CREDENTIAL_STATE_CHANGED", "凭证投递状态已变化")
	case 47:
		return httpx.E(409, "GIT_CONFIG_BUSY", "仓库 Git 配置正在修改，请稍后重试")
	default:
		return httpx.E(409, "SANDBOX_GIT_OPERATION_FAILED", "沙箱 Git 操作失败")
	}
}

func (g *gitPlatformAPI) initRepo(ctx context.Context, x agentcore.ExecutionContext, call agentcore.ID, raw json.RawMessage) (json.RawMessage, error) {
	var args struct {
		ID   string `json:"project_repo_id"`
		Path string `json:"path"`
	}
	if json.Unmarshal(raw, &args) != nil || args.Path == "" || strings.ContainsFunc(args.Path, unicode.IsControl) {
		return nil, httpx.Invalid("path", "invalid_format")
	}
	id, err := c.ID(args.ID)
	if err != nil {
		return nil, err
	}
	remote, err := g.integrations.AgentGitRemote(ctx, x.Authorization, id)
	if err != nil {
		return nil, err
	}
	if remote.Email == "" {
		return nil, httpx.E(409, "GIT_EMAIL_REQUIRED", "请先在个人资料或机器人管理中填写执行账号的邮箱")
	}
	if strings.ContainsFunc(remote.DisplayName, unicode.IsControl) {
		return nil, httpx.E(409, "GIT_IDENTITY_INVALID", "请移除执行账号显示名称中的控制字符")
	}
	return g.withComputer(ctx, x, call, func(a *gitSandbox) (json.RawMessage, error) {
		target := args.Path
		if !path.IsAbs(target) {
			target = path.Join(a.CWD, target)
		}
		status, target, err := gitProcess(ctx, a, false, "/bin/sh", "-c", initGitScript, "git-init", target, remote.Origin, remote.Base, strconv.FormatUint(remote.Connection, 10), remote.DisplayName, remote.Email)
		if err != nil {
			return nil, err
		}
		if err = gitExit(status); err != nil {
			return nil, err
		}
		if !path.IsAbs(target) {
			return nil, &sandboxcore.Error{Code: "GIT_INIT_OUTCOME_UNKNOWN", Unknown: true}
		}
		remote.Path = target
		return json.Marshal(remote)
	})
}

type credentialInstall struct {
	access                   *gitSandbox
	connection, request, uid string
}

func (i credentialInstall) step(ctx context.Context, action string, m integrations.GitMaterial) (int, error) {
	status, _, err := gitProcess(ctx, i.access, true, "/bin/sh", "-c", gitCredentialScript, "git-credentials", action, i.connection, i.request, m.Version, i.uid, m.Base)
	return status, err
}
func (i credentialInstall) upload(ctx context.Context, name, contents string) error {
	root := uint32(0)
	dest := path.Join("/run/platform/svc-creds", i.connection, "stage", i.request, name)
	if err := i.access.checkpoint(ctx, ""); err != nil {
		return err
	}
	return i.access.Provider.PutFile(ctx, i.access.Resource, sandboxcore.FileRequest{Path: dest, Mode: 600, MaxBytes: int64(len(contents)), UID: &root, GID: &root}, strings.NewReader(contents))
}

// Revocation is a confirmed sandbox write even when the credential request fails.
var errGitCredentialRevoked = errors.New("previous sandbox credential removed")

func clearGitCredential(err error) bool {
	var failure *httpx.Error
	if !errors.As(err, &failure) {
		return false
	}
	switch failure.Code {
	case "NOT_FOUND", "PERSONAL_PREFERRED_REQUIRED", "CREDENTIAL_UNAVAILABLE", "RESOURCE_DISABLED", "GIT_HTTPS_REQUIRED":
		return true
	}
	return false
}

func (g *gitPlatformAPI) ensure(ctx context.Context, x agentcore.ExecutionContext, call agentcore.ID, raw json.RawMessage) (json.RawMessage, error) {
	var args struct {
		Connection string `json:"conn_id"`
	}
	if json.Unmarshal(raw, &args) != nil {
		return nil, httpx.Invalid("conn_id", "invalid_format")
	}
	id, err := c.ID(args.Connection)
	if err != nil {
		return nil, err
	}
	return g.withComputer(ctx, x, call, func(a *gitSandbox) (json.RawMessage, error) {
		lock := &g.credentialLocks[(a.InstanceID+id)%uint64(len(g.credentialLocks))]
		lock.Lock()
		defer lock.Unlock()
		i := credentialInstall{access: a, connection: args.Connection, request: agents.NewStorageKey()}
		lookup := func(decrypt bool) (integrations.GitMaterial, error) {
			return g.integrations.AgentGitCredential(ctx, x.Authorization, id, decrypt)
		}
		meta, err := lookup(false)
		if err == nil {
			err = i.install(ctx, meta, lookup)
		}
		if clearGitCredential(err) {
			status, revokeErr := i.step(ctx, "revoke", integrations.GitMaterial{})
			if revokeErr != nil {
				return nil, revokeErr
			}
			if status == 46 {
				return nil, errors.Join(err, errGitCredentialRevoked)
			}
			if e := gitExit(status); e != nil {
				return nil, e
			}
		}
		if err != nil {
			return nil, err
		}
		return json.Marshal(map[string]any{"conn_id": args.Connection, "ready": true})
	})
}
func (i credentialInstall) install(ctx context.Context, meta integrations.GitMaterial, lookup func(bool) (integrations.GitMaterial, error)) (cause error) {
	status, uid, err := gitProcess(ctx, i.access, false, "/usr/bin/id", "-u")
	if err != nil {
		return err
	}
	n, err := strconv.ParseUint(uid, 10, 32)
	if status != 0 || err != nil {
		return httpx.E(409, "SANDBOX_IDENTITY_UNAVAILABLE", "沙箱执行身份不可用")
	}
	i.uid = strconv.FormatUint(n, 10)
	status, err = i.step(ctx, "prepare", meta)
	if err != nil {
		return err
	}
	if status != 43 {
		return gitExit(status)
	}
	defer func() {
		var remote *sandboxcore.Error
		if cause == nil || errors.As(cause, &remote) && remote.Unknown {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		status, err := i.step(cleanup, "abort", meta)
		if err != nil || status != 0 {
			cause = &sandboxcore.Error{Code: "CREDENTIAL_CLEANUP_UNKNOWN", Unknown: true}
		}
	}()
	material, err := lookup(true)
	if err != nil {
		return err
	}
	if material.Version != meta.Version {
		return gitExit(45)
	}
	if err = i.upload(ctx, "credentials", material.Credential); err != nil {
		return err
	}
	if material.CA != "" {
		if err = i.upload(ctx, "ca.pem", material.CA); err != nil {
			return err
		}
	}
	current, err := lookup(false)
	if err != nil {
		return err
	}
	if current.Version != meta.Version {
		return gitExit(45)
	}
	status, err = i.step(ctx, "publish", current)
	if err != nil {
		return err
	}
	return gitExit(status)
}
