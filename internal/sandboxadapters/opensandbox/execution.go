package opensandbox

import (
	"context"
	"encoding/json"
	"math"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func (p *Provider) Exec(ctx context.Context, ref sandboxcore.ResourceRef, s sandboxcore.ExecSpec, callbacks sandboxcore.ExecCallbacks) (sandboxcore.ExecResult, error) {
	out := sandboxcore.ExecResult{}
	request, err := commandRequest(s)
	if err != nil {
		return out, err
	}
	if callbacks.Started == nil {
		return out, failure("SANDBOX_HANDLE_CALLBACK_REQUIRED", false)
	}
	ctx, cancel := context.WithTimeout(ctx, s.Timeout+10*time.Second)
	defer cancel()
	client, err := p.execd(ctx, ref)
	if err != nil {
		return out, err
	}
	complete, started, used := false, false, 0
	err = client.RunCommand(ctx, request, func(event sdk.StreamEvent) error {
		var ev struct {
			Type     string `json:"type"`
			Text     string `json:"text"`
			ExitCode *int32 `json:"exit_code"`
			Error    *struct {
				ExitCode *int32 `json:"exit_code"`
				Name     string `json:"ename"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(event.Data), &ev) != nil {
			return failure("SANDBOX_STREAM_INVALID", true)
		}
		if ev.Type == "ping" {
			return nil
		}
		// Terminal notifications may precede buffered stdout/stderr. Drain those
		// frames while still rejecting a second terminal event or handle.
		if complete && ev.Type != "stdout" && ev.Type != "stderr" {
			return failure("SANDBOX_STREAM_INVALID", true)
		}
		if ev.Type == "init" {
			if started || !validRemoteID(ev.Text) {
				return failure("SANDBOX_STREAM_INVALID", true)
			}
			handle := sandboxcore.ExecutionHandle{Resource: ref, ID: ev.Text}
			out.Handle = &handle
			out.Running = true
			if err := callbacks.Started(ctx, handle); err != nil {
				return failure("SANDBOX_HANDLE_PERSIST_FAILED", true)
			}
			started = true
			return nil
		}
		if !started {
			return failure("SANDBOX_STREAM_INVALID", true)
		}
		switch ev.Type {
		case "stdout", "stderr":
			text := ev.Text
			if len(text) > s.MaxOutputBytes-used {
				text = text[:s.MaxOutputBytes-used]
				for !utf8.ValidString(text) && len(text) > 0 {
					text = text[:len(text)-1]
				}
				out.OutputTruncated = true
			}
			used += len(text)
			if text != "" && callbacks.Output != nil {
				if err := callbacks.Output(ctx, sandboxcore.Output{Stream: ev.Type, Text: text}); err != nil {
					return failure("SANDBOX_OUTPUT_CONSUMER_FAILED", true)
				}
			}
		case "error":
			if ev.Error != nil && ev.Error.ExitCode != nil {
				out.ExitCode = ev.Error.ExitCode
			} else if ev.ExitCode != nil {
				out.ExitCode = ev.ExitCode
			}
			// A nonzero foreground exit is a terminal command observation, not a
			// transport failure. Older execd sends only CommandExecError/evalue;
			// confirm its exit code through status instead of parsing error text.
			if !s.Background && (out.ExitCode != nil || ev.Error != nil && ev.Error.Name == "CommandExecError") {
				complete, out.Running = true, false
			}
		case "execution_complete":
			complete = true
			if !s.Background {
				out.Running = false
				if ev.ExitCode != nil {
					out.ExitCode = ev.ExitCode
				}
			}
		default:
			return failure("SANDBOX_STREAM_INVALID", true)
		}
		return nil
	})
	if err != nil {
		return out, remoteError(err, true)
	}
	if !started || !complete {
		return out, failure("SANDBOX_EXECUTION_UNCONFIRMED", true)
	}
	if s.Background {
		// This event acknowledges launch. It is not the process terminal state.
		out.Running = true
		out.ExitCode = nil
		return out, nil
	}
	if out.ExitCode == nil {
		// Older execd releases omit a foreground exit code. Confirm through the
		// status API rather than inventing a successful exit.
		status, statusErr := p.InspectExecution(ctx, *out.Handle)
		if statusErr != nil {
			return out, statusErr
		}
		out.Running = status.Running
		out.ExitCode = status.ExitCode
		if out.Running || out.ExitCode == nil {
			return out, failure("SANDBOX_EXECUTION_UNCONFIRMED", true)
		}
	}
	return out, nil
}

func commandRequest(s sandboxcore.ExecSpec) (sdk.RunCommandRequest, error) {
	invalid := failure("SANDBOX_COMMAND_INVALID", false)
	if (s.Command == "") == (len(s.Argv) == 0) || len(s.Command) > 64<<10 || len(s.Argv) > 128 || s.Timeout <= 0 || s.Timeout > 24*time.Hour || s.MaxOutputBytes < 1 || s.MaxOutputBytes > 1<<20 || len(s.CWD) > 4096 || !strings.HasPrefix(s.CWD, "/") || path.Clean(s.CWD) != s.CWD || strings.ContainsRune(s.CWD, 0) || strings.ContainsRune(s.Command, 0) {
		return sdk.RunCommandRequest{}, invalid
	}
	total := 0
	for _, arg := range s.Argv {
		total += len(arg)
		if strings.ContainsRune(arg, 0) {
			return sdk.RunCommandRequest{}, invalid
		}
	}
	if total > 64<<10 || len(s.Argv) > 0 && s.Argv[0] == "" {
		return sdk.RunCommandRequest{}, invalid
	}
	uid, gid := (*int32)(nil), (*int32)(nil)
	if (s.UID == nil) != (s.GID == nil) {
		return sdk.RunCommandRequest{}, invalid
	}
	if s.UID != nil {
		if *s.UID > math.MaxInt32 || *s.GID > math.MaxInt32 {
			return sdk.RunCommandRequest{}, invalid
		}
		u, g := int32(*s.UID), int32(*s.GID)
		uid, gid = &u, &g
	}
	return sdk.RunCommandRequest{Command: s.Command, Argv: s.Argv, Cwd: s.CWD, UID: uid, GID: gid, Background: s.Background, Timeout: s.Timeout.Milliseconds()}, nil
}

func (p *Provider) InspectExecution(ctx context.Context, h sandboxcore.ExecutionHandle) (sandboxcore.ExecResult, error) {
	out := sandboxcore.ExecResult{Handle: &h}
	if !validRemoteID(h.ID) {
		return out, failure("SANDBOX_COMMAND_INVALID", false)
	}
	client, err := p.execd(ctx, h.Resource)
	if err != nil {
		return out, err
	}
	status, err := client.GetCommandStatus(ctx, h.ID)
	if err != nil {
		return out, remoteError(err, false)
	}
	if status == nil || status.ID != h.ID || status.Running && status.ExitCode != nil {
		return out, failure("SANDBOX_RESPONSE_INVALID", false)
	}
	out.Running, out.ExitCode = status.Running, status.ExitCode
	if !out.Running && out.ExitCode == nil {
		return out, failure("SANDBOX_EXECUTION_UNCONFIRMED", true)
	}
	return out, nil
}

func (p *Provider) CancelExecution(ctx context.Context, h sandboxcore.ExecutionHandle) error {
	if !validRemoteID(h.ID) {
		return failure("SANDBOX_COMMAND_INVALID", false)
	}
	client, err := p.execd(ctx, h.Resource)
	if err != nil {
		return err
	}
	// Acknowledgment only: the host must inspect before releasing occupancy.
	return remoteError(client.InterruptCommand(ctx, h.ID), true)
}
