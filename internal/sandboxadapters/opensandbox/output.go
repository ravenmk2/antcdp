package opensandbox

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"unicode/utf8"

	"github.com/ravenmk2/antcdp/internal/platform/filestore"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// A frame is a channel byte, a four-byte size, then UTF-8 text. A final
// frame distinguishes a drained stream from a lost reader after restart.
const (
	stdoutFrame byte = iota + 1
	stderrFrame
	completeFrame
	incompleteFrame
	gapFrame
	journalLimit = 4 << 20
	tailBudget   = 4096
)

type outputJournal struct {
	file      *os.File
	remaining int
	overflow  bool
	tails     [2]string
}

func openJournal(path string) (*outputJournal, error) {
	if err := filestore.EnsurePrivateDir(filepath.Dir(path)); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	return &outputJournal{file: f, remaining: journalLimit}, nil
}
func prefix(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}
func suffix(s string, n int) string {
	if len(s) <= n {
		return s
	}
	i := len(s) - n
	for i < len(s) && !utf8.RuneStart(s[i]) {
		i++
	}
	return s[i:]
}
func (j *outputJournal) frame(kind byte, text string) error {
	b := make([]byte, 5, len(text)+5)
	b[0] = kind
	binary.BigEndian.PutUint32(b[1:], uint32(len(text)))
	b = append(b, text...)
	_, err := j.file.Write(b)
	return err
}
func (j *outputJournal) appendOutput(o sandboxcore.Output) error {
	kind := stdoutFrame
	if o.Stream == "stderr" {
		kind = stderrFrame
	}
	// Charge framing too, so a verbose process using one-byte writes is bounded.
	text := prefix(o.Text, max(0, j.remaining-5))
	if len(text) > 0 {
		if err := j.frame(kind, text); err != nil {
			return err
		}
		j.remaining -= 5 + len(text)
	}
	if len(text) < len(o.Text) {
		if !j.overflow {
			if err := j.frame(gapFrame, ""); err != nil {
				return err
			}
		}
		j.remaining = 0
		j.overflow = true
		i := kind - 1
		j.tails[i] = suffix(j.tails[i]+o.Text[len(text):], tailBudget)
	}
	return nil
}
func (j *outputJournal) finish(lost bool) {
	defer func() { _ = j.file.Close() }()
	for i, tail := range j.tails {
		if tail != "" {
			if err := j.frame(byte(i)+stdoutFrame, tail); err != nil {
				return
			}
		}
	}
	kind := completeFrame
	if lost || j.overflow {
		kind = incompleteFrame
	}
	if j.frame(kind, "") == nil {
		_ = j.file.Sync()
	}
}
func preview(s string, n int) string {
	const skip = "\n…\n"
	if len(s) <= n {
		return s
	}
	if n <= len(skip) {
		return prefix(s, n)
	}
	usable := n - len(skip)
	return prefix(s, usable/2) + skip + suffix(s, usable-usable/2)
}
func (p *Provider) ReadExecutionOutput(ctx context.Context, h sandboxcore.ExecutionHandle, cursor int64, maxBytes int) (sandboxcore.ExecutionOutput, error) {
	return p.streams.read(ctx, h, cursor, maxBytes)
}

func (f Factory) ReadSavedOutput(ctx context.Context, h sandboxcore.ExecutionHandle, cursor int64, maxBytes int) (sandboxcore.ExecutionOutput, error) {
	return f.streams.read(ctx, h, cursor, maxBytes)
}

func (s *commandStreams) read(ctx context.Context, h sandboxcore.ExecutionHandle, cursor int64, maxBytes int) (sandboxcore.ExecutionOutput, error) {
	var out sandboxcore.ExecutionOutput
	if !validRemoteID(h.ID) || cursor < sandboxcore.PreviewCursor || maxBytes < 4 || maxBytes > 1<<20 || s == nil {
		return out, failure("SANDBOX_COMMAND_INVALID", false)
	}
	if err := ctx.Err(); err != nil {
		return out, err
	}
	path := s.path(h)
	// Sample liveness first: a reader that finishes concurrently publishes its
	// footer before removing the active entry.
	out.Pending = s.isActive(path)
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		out.Incomplete = true
		return out, nil
	}
	if err != nil {
		return out, failure("SANDBOX_OUTPUT_UNAVAILABLE", false)
	}
	return readJournal(data, cursor, maxBytes, out.Pending)
}
func readJournal(data []byte, cursor int64, budget int, pending bool) (sandboxcore.ExecutionOutput, error) {
	var out sandboxcore.ExecutionOutput
	var streams [2][]byte
	var offset int64
	previewing := cursor == sandboxcore.PreviewCursor
	remaining := budget
	ended := false
	for len(data) >= 5 {
		kind := data[0]
		n := int(binary.BigEndian.Uint32(data[1:5]))
		data = data[5:]
		if n > len(data) {
			break
		}
		value := data[:n]
		data = data[n:]
		if kind == gapFrame {
			out.Incomplete = true
			continue
		}
		if kind == completeFrame || kind == incompleteFrame {
			ended = true
			out.Incomplete = out.Incomplete || kind == incompleteFrame
			break
		}
		if kind != stdoutFrame && kind != stderrFrame {
			return out, failure("SANDBOX_OUTPUT_INVALID", false)
		}
		end := offset + int64(n)
		if previewing {
			streams[kind-1] = append(streams[kind-1], value...)
		} else if end > cursor && remaining > 0 {
			start := int(max(0, cursor-offset))
			if !utf8.RuneStart(value[start]) {
				return out, failure("SANDBOX_CURSOR_INVALID", false)
			}
			text := prefix(string(value[start:]), remaining)
			streams[kind-1] = append(streams[kind-1], text...)
			remaining -= len(text)
			if len(text) < len(value)-start {
				remaining = 0
			}
		}
		offset = end
	}
	out.Pending = pending && !ended
	out.Incomplete = out.Incomplete || (!ended && !pending)
	out.Stdout, out.Stderr = string(streams[0]), string(streams[1])
	if previewing {
		out.Truncated = len(out.Stdout)+len(out.Stderr) > budget
		if out.Truncated {
			stderrBudget := min(len(out.Stderr), max(budget/2, budget-len(out.Stdout)))
			out.Stdout = preview(out.Stdout, budget-stderrBudget)
			out.Stderr = preview(out.Stderr, stderrBudget)
		}
		out.Cursor = offset
	} else {
		if cursor > offset {
			return out, failure("SANDBOX_CURSOR_INVALID", false)
		}
		out.Cursor = cursor + int64(len(out.Stdout)+len(out.Stderr))
		out.Truncated = out.Cursor < offset
	}
	return out, nil
}
