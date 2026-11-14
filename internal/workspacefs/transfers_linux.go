//go:build linux

package workspacefs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"strconv"

	"golang.org/x/sys/unix"
)

func fmtSize(n int64) string { return strconv.FormatInt(n, 10) }

func (e *Engine) transferRoot() (*root, error) {
	r, err := openRoot(e.TransferRoot)
	if err != nil {
		return nil, err
	}
	var st unix.Stat_t
	if unix.Fstat(r.fd, &st) != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&0777 != 0700 {
		r.close()
		return nil, failure("WORKSPACE_PRIVATE_DIRECTORY_INVALID")
	}
	return r, nil
}

func (e *Engine) transfer(ctx context.Context, r *root, q Request) (any, bool, error) {
	if !validToken(q.Token) {
		return nil, false, failure("WORKSPACE_TRANSFER_INVALID")
	}
	t, err := e.transferRoot()
	if err != nil {
		return nil, false, err
	}
	defer t.close()
	if q.Operation == "transfer_cleanup" {
		budget := 10
		err = removeAt(ctx, t.fd, q.Token, &budget)
		return map[string]any{"cleaned": err == nil}, err == nil, err
	}
	if q.Operation == "transfer_begin" {
		err = unix.Mkdirat(t.fd, q.Token, 0700)
		return map[string]any{"path": TransferDirectory + "/" + q.Token + "/payload"}, err == nil, ioError(err)
	}
	private, err := t.ownedDirectory(q.Token)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = private.Close() }()
	if q.Operation == "export" {
		return e.export(ctx, r, t, q)
	}
	name, err := Normalize(q.Path, false)
	if err != nil || reserved(name) || q.Overwrite || !validHash(q.ExpectedHash) {
		return nil, false, failure("WORKSPACE_IMPORT_INVALID")
	}
	payload, err := t.open(q.Token+"/payload", unix.O_RDONLY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = payload.Close() }()
	st, err := statFile(payload)
	if err != nil {
		return nil, false, err
	}
	if err = regular(st); err != nil || st.Size > MaxFileBytes {
		return nil, false, failure("WORKSPACE_TRANSFER_INVALID")
	}
	h := sha256.New()
	if _, err = io.Copy(h, contextReader{ctx: ctx, r: payload}); err != nil || hex.EncodeToString(h.Sum(nil)) != q.ExpectedHash {
		return nil, false, failure("WORKSPACE_TRANSFER_HASH_MISMATCH")
	}
	if _, err = payload.Seek(0, io.SeekStart); err != nil {
		return nil, false, ioError(err)
	}
	changed, err := e.atomicWrite(r, name, contextReader{ctx: ctx, r: payload}, st.Size, false, "")
	return map[string]any{"path": name, "sha256": q.ExpectedHash, "size_bytes": fmtSize(st.Size)}, changed, err
}

func (e *Engine) export(ctx context.Context, r, t *root, q Request) (any, bool, error) {
	name, err := PublicPath(q.Path, true)
	if err != nil {
		return nil, false, err
	}
	source, err := r.open(name, unix.O_RDONLY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = source.Close() }()
	before, err := statFile(source)
	if err != nil {
		return nil, false, err
	}
	if err = regular(before); err != nil || before.Size > MaxFileBytes {
		return nil, false, failure("WORKSPACE_SOURCE_INVALID")
	}
	if q.Identity != "" && q.Identity != identity(before) {
		return nil, false, failure("WORKSPACE_ENTRY_CHANGED")
	}
	out, err := t.open(q.Token+"/payload", unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0600)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = out.Close() }()
	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(out, h), io.LimitReader(contextReader{ctx: ctx, r: source}, before.Size+1))
	if err != nil || n != before.Size {
		return nil, true, failure("WORKSPACE_SOURCE_CHANGED")
	}
	after, err := statFile(source)
	if err != nil || !sameFile(before, after) {
		return nil, true, failure("WORKSPACE_SOURCE_CHANGED")
	}
	if err = out.Sync(); err != nil {
		return nil, true, ioError(err)
	}
	return map[string]any{"transfer_path": TransferDirectory + "/" + q.Token + "/payload", "source_path": q.Path, "size_bytes": fmtSize(n), "sha256": hex.EncodeToString(h.Sum(nil)), "identity": identity(before)}, true, nil
}
