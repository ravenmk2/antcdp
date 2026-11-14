package agents

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/filestore"
)

var storageKeyPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

type ByteFacts struct {
	Size   uint64
	SHA256 []byte
}
type ReadSeekCloser interface {
	io.Reader
	io.Seeker
	io.Closer
}
type ByteStore struct{ root string }

func NewByteStore(root string) (*ByteStore, error) {
	path, e := filepath.Abs(root)
	if e != nil {
		return nil, e
	}
	if e = filestore.EnsurePrivateDir(path); e != nil {
		return nil, e
	}
	return &ByteStore{root: path}, nil
}
func NewStorageKey() string { return fmt.Sprintf("%x", cryptox.Random(16)) }
func (s *ByteStore) path(key string) (string, error) {
	if s == nil || !storageKeyPattern.MatchString(key) {
		return "", errors.New("invalid private storage key")
	}
	if e := filestore.EnsurePrivateDir(s.root); e != nil {
		return "", e
	}
	return filepath.Join(s.root, key+".blob"), nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.reader.Read(b)
}

// Write publishes complete bytes without replacing an existing key. Content
// authorization and uploading/staged/bound transitions belong to host transactions.
func (s *ByteStore) Write(ctx context.Context, key string, source io.Reader, limit int64) (ByteFacts, error) {
	target, e := s.path(key)
	if e != nil {
		return ByteFacts{}, e
	}
	if limit < 0 || limit == int64(^uint64(0)>>1) {
		return ByteFacts{}, errors.New("invalid byte limit")
	}
	tmp := filepath.Join(s.root, ".upload-"+NewStorageKey())
	if e = filestore.CreatePrivate(tmp, nil); e != nil {
		return ByteFacts{}, e
	}
	defer func() { _ = os.Remove(tmp) }()
	f, e := os.OpenFile(tmp, os.O_WRONLY, 0600)
	if e != nil {
		return ByteFacts{}, e
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	n, e := io.Copy(io.MultiWriter(f, h), io.LimitReader(contextReader{ctx, source}, limit+1))
	if e != nil {
		return ByteFacts{}, e
	}
	if n > limit {
		return ByteFacts{}, errors.New("file exceeds byte limit")
	}
	if e = f.Sync(); e != nil {
		return ByteFacts{}, e
	}
	if e = f.Close(); e != nil {
		return ByteFacts{}, e
	}
	// Link publication fails if target exists; no replacement or rename gap.
	if e = os.Link(tmp, target); e != nil {
		return ByteFacts{}, e
	}
	if e = filestore.SyncDir(s.root); e != nil {
		return ByteFacts{}, e
	}
	return ByteFacts{uint64(n), h.Sum(nil)}, nil
}
func (s *ByteStore) Open(key string) (ReadSeekCloser, error) {
	path, e := s.path(key)
	if e != nil {
		return nil, e
	}
	info, e := os.Lstat(path)
	if e != nil {
		return nil, e
	}
	if !info.Mode().IsRegular() {
		return nil, errors.New("invalid private file")
	}
	return os.Open(path)
}
func (s *ByteStore) Inspect(ctx context.Context, key string, limit int64) (ByteFacts, error) {
	if limit < 0 || limit == int64(^uint64(0)>>1) {
		return ByteFacts{}, errors.New("invalid byte limit")
	}
	f, e := s.Open(key)
	if e != nil {
		return ByteFacts{}, e
	}
	defer func() { _ = f.Close() }()
	h := sha256.New()
	n, e := io.Copy(h, io.LimitReader(contextReader{ctx, f}, limit+1))
	if e != nil {
		return ByteFacts{}, e
	}
	if n > limit {
		return ByteFacts{}, errors.New("file exceeds byte limit")
	}
	return ByteFacts{uint64(n), h.Sum(nil)}, nil
}
func (s *ByteStore) Delete(key string) error {
	path, e := s.path(key)
	if e != nil {
		return e
	}
	info, e := os.Lstat(path)
	if errors.Is(e, os.ErrNotExist) {
		return nil
	}
	if e != nil {
		return e
	}
	if !info.Mode().IsRegular() {
		return errors.New("invalid private file")
	}
	if e = os.Remove(path); e != nil {
		return e
	}
	return filestore.SyncDir(s.root)
}
