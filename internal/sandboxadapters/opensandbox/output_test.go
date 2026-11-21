package opensandbox

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestCommandJournalPagesAndRestart(t *testing.T) {
	dir := t.TempDir()
	streams := newCommandStreams(dir)
	p := Provider{streams: streams}
	h := sandboxcore.ExecutionHandle{Resource: testRef(), ID: "exec-1"}
	path := streams.path(h)
	w, err := openJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	streams.setActive(path, true)
	for _, chunk := range []sandboxcore.Output{{Stream: "stdout", Text: "中文"}, {Stream: "stderr", Text: "failed"}} {
		if err = w.appendOutput(chunk); err != nil {
			t.Fatal(err)
		}
	}
	read := func(cursor int64, limit int) sandboxcore.ExecutionOutput {
		t.Helper()
		o, e := p.ReadExecutionOutput(context.Background(), h, cursor, limit)
		if e != nil {
			t.Fatal(e)
		}
		return o
	}
	one := read(0, 4)
	if one.Stdout != "中" || one.Cursor != 3 || !one.Pending || !one.Truncated || read(0, 4) != one {
		t.Fatal(one)
	}
	p.streams = newCommandStreams(dir)
	partial := read(3, 100)
	if partial.Pending || !partial.Incomplete || partial.Stdout != "文" || partial.Stderr != "failed" {
		t.Fatal(partial)
	}
	w.finish(false)
	if final := read(3, 100); final.Incomplete || final.Pending || final.Cursor != 12 {
		t.Fatal(final)
	}
}

func TestJournalKeepsDiagnosticsAfterRetentionLimit(t *testing.T) {
	path := t.TempDir() + "/test.log"
	w, e := openJournal(path)
	if e != nil {
		t.Fatal(e)
	}
	w.remaining = 64
	if e = w.appendOutput(sandboxcore.Output{Stream: "stdout", Text: strings.Repeat("x", 4096)}); e != nil {
		t.Fatal(e)
	}
	if e = w.appendOutput(sandboxcore.Output{Stream: "stderr", Text: "final error"}); e != nil {
		t.Fatal(e)
	}
	w.finish(false)
	data, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	o, e := readJournal(data, sandboxcore.PreviewCursor, 64, false)
	if e != nil || !o.Truncated || !o.Incomplete || o.Stderr != "final error" || len(o.Stdout)+len(o.Stderr) > 64 {
		t.Fatal(o, e)
	}
}
