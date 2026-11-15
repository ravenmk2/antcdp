package mysql

import (
	"bytes"
	"context"
	"io"
	"path"
	"strings"
	"time"

	sb "github.com/ravenmk2/antcdp/internal/sandboxcore"
)

// Native API fake: no executable, transfer directory or identity override.
type nativeMemoryFS struct {
	files    map[string][]byte
	prefix   string
	mutation func() error
}

func (f nativeMemoryFS) key(name string) string { return f.prefix + strings.TrimPrefix(name, "/data/") }
func (f nativeMemoryFS) info(name string) (sb.FileInfo, error) {
	data, ok := f.files[f.key(name)]
	if name == "/data" {
		ok = true
		data = nil
	}
	if !ok {
		return sb.FileInfo{}, &sb.Error{Code: "SANDBOX_FILE_NOT_FOUND"}
	}
	kind := "file"
	if data == nil {
		kind = "directory"
	}
	return sb.FileInfo{Path: name, Kind: kind, Size: int64(len(data)), ModifiedAt: time.Unix(1, 0), Mode: 644}, nil
}
func (f nativeMemoryFS) StatFile(_ context.Context, _ sb.ResourceRef, name string) (sb.FileInfo, error) {
	return f.info(name)
}
func (f nativeMemoryFS) ListFiles(ctx context.Context, r sb.ResourceRef, name string) ([]sb.FileInfo, error) {
	all, _ := f.SearchFiles(ctx, r, name, "**")
	out := []sb.FileInfo{}
	for _, v := range all {
		if path.Dir(v.Path) == name {
			out = append(out, v)
		}
	}
	return out, nil
}
func (f nativeMemoryFS) SearchFiles(_ context.Context, _ sb.ResourceRef, name, pattern string) ([]sb.FileInfo, error) {
	out := []sb.FileInfo{}
	for key := range f.files {
		relative, ok := strings.CutPrefix(key, f.prefix)
		if !ok {
			continue
		}
		full := "/data/" + relative
		if strings.HasPrefix(full, name+"/") {
			v, _ := f.info(full)
			out = append(out, v)
		}
	}
	return out, nil
}
func (f nativeMemoryFS) MakeDirectory(_ context.Context, _ sb.ResourceRef, name string, _ int) error {
	if err := f.mutation(); err != nil {
		return err
	}
	for name != "/data" && name != "/" && name != "." {
		f.files[f.key(name)] = nil
		name = path.Dir(name)
	}
	return nil
}
func (f nativeMemoryFS) RemoveFile(_ context.Context, _ sb.ResourceRef, name string, _ bool) error {
	if err := f.mutation(); err != nil {
		return err
	}
	key := f.key(name)
	for k := range f.files {
		if k == key || strings.HasPrefix(k, key+"/") {
			delete(f.files, k)
		}
	}
	return nil
}
func (f nativeMemoryFS) MoveFile(_ context.Context, _ sb.ResourceRef, from, to string) error {
	if err := f.mutation(); err != nil {
		return err
	}
	key := f.key(from)
	updates := map[string][]byte{}
	for k, v := range f.files {
		if k == key || strings.HasPrefix(k, key+"/") {
			updates[f.key(to)+strings.TrimPrefix(k, key)] = v
			delete(f.files, k)
		}
	}
	for k, v := range updates {
		f.files[k] = v
	}
	return nil
}
func (f nativeMemoryFS) SetFilePermissions(context.Context, sb.ResourceRef, string, int) error {
	return nil
}
func (f nativeMemoryFS) ReplaceFile(context.Context, sb.ResourceRef, string, string, string) (int, error) {
	panic("unexpected replace")
}
func (f nativeMemoryFS) OpenFile(_ context.Context, _ sb.ResourceRef, q sb.FileRequest) (io.ReadCloser, error) {
	if q.UID != nil || q.GID != nil {
		panic("native file read forced identity")
	}
	data, ok := f.files[f.key(q.Path)]
	if !ok {
		return nil, &sb.Error{Code: "SANDBOX_FILE_NOT_FOUND"}
	}
	start := min(q.Offset, int64(len(data)))
	end := int64(len(data))
	if q.Length > 0 {
		end = min(start+q.Length, end)
	}
	return io.NopCloser(bytes.NewReader(data[start:end])), nil
}
func (f nativeMemoryFS) PutFile(_ context.Context, _ sb.ResourceRef, q sb.FileRequest, r io.Reader) error {
	if q.UID != nil || q.GID != nil {
		panic("native upload forced identity")
	}
	if err := f.mutation(); err != nil {
		return err
	}
	data, err := io.ReadAll(io.LimitReader(r, q.MaxBytes+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > q.MaxBytes {
		return &sb.Error{Code: "SANDBOX_TRANSFER_TOO_LARGE", Unknown: true}
	}
	f.files[f.key(q.Path)] = append([]byte{}, data...)
	return nil
}
