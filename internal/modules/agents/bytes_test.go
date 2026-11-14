package agents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"testing"
)

func TestByteStorePublication(t *testing.T) {
	s, e := NewByteStore(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	key := NewStorageKey()
	body := []byte("内容 bytes\x00\xff")
	facts, e := s.Write(context.Background(), key, bytes.NewReader(body), 100)
	if e != nil {
		t.Fatal(e)
	}
	want := sha256.Sum256(body)
	if facts.Size != uint64(len(body)) || !bytes.Equal(facts.SHA256, want[:]) {
		t.Fatal("wrong byte facts")
	}
	if _, e = s.Write(context.Background(), key, bytes.NewBufferString("replace"), 100); !errors.Is(e, os.ErrExist) {
		t.Fatal("existing key replaced", e)
	}
	f, e := s.Open(key)
	if e != nil {
		t.Fatal(e)
	}
	got, e := io.ReadAll(f)
	_ = f.Close()
	if e != nil || !bytes.Equal(got, body) {
		t.Fatal("bytes changed", e)
	}
	inspected, e := s.Inspect(context.Background(), key, 100)
	if e != nil || !bytes.Equal(inspected.SHA256, want[:]) {
		t.Fatal("inspect", e)
	}
	tooLarge := NewStorageKey()
	if _, e = s.Write(context.Background(), tooLarge, bytes.NewBufferString("1234"), 3); e == nil {
		t.Fatal("oversize accepted")
	}
	if _, e = s.Open(tooLarge); !errors.Is(e, os.ErrNotExist) {
		t.Fatal("partial bytes published", e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = s.Write(ctx, NewStorageKey(), bytes.NewBufferString("cancelled"), 100); !errors.Is(e, context.Canceled) {
		t.Fatal("cancelled source copied", e)
	}
	for _, key := range []string{"../escape", "", NewStorageKey() + "/file", "ABCDEF"} {
		if _, e = s.Open(key); e == nil {
			t.Fatal("invalid key accepted")
		}
	}
	if e = s.Delete(key); e != nil {
		t.Fatal(e)
	}
	if e = s.Delete(key); e != nil {
		t.Fatal("delete not idempotent", e)
	}
}
