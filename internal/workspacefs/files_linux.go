//go:build linux

package workspacefs

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path"
	"sort"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

func (e *Engine) list(r *root, q Request) (any, error) {
	name, err := PublicPath(q.Path, true)
	if err != nil {
		return nil, err
	}
	f, err := r.open(name, unix.O_RDONLY|unix.O_DIRECTORY, 0)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	names, err := f.Readdirnames(MaxWalkEntries + 1)
	if err != nil && err != io.EOF {
		return nil, ioError(err)
	}
	if len(names) > MaxWalkEntries {
		return nil, failure("WORKSPACE_DIRECTORY_TOO_LARGE")
	}
	limit := q.Limit
	if limit < 1 || limit > 200 {
		limit = 100
	}
	if q.Offset < 0 || q.Offset > MaxWalkEntries {
		return nil, failure("WORKSPACE_REQUEST_INVALID")
	}
	all := make([]Entry, 0, len(names))
	for _, child := range names {
		if child == ".system" {
			continue
		}
		var st unix.Stat_t
		if err = unix.Fstatat(int(f.Fd()), child, &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
			return nil, ioError(err)
		}
		item := entry(child, path.Join(q.Path, child), st)
		if item.Kind == "file" || item.Kind == "directory" {
			all = append(all, item)
		}
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].Kind != all[j].Kind {
			return all[i].Kind == "directory"
		}
		return all[i].Name < all[j].Name
	})
	start := min(int(q.Offset), len(all))
	end := min(start+limit, len(all))
	return map[string]any{"entries": all[start:end], "total": len(all), "has_more": end < len(all), "next_offset": end}, nil
}

func (e *Engine) read(r *root, q Request) (any, error) {
	name, err := PublicPath(q.Path, true)
	if err != nil {
		return nil, err
	}
	f, err := r.open(name, unix.O_RDONLY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	before, err := statFile(f)
	if err != nil {
		return nil, err
	}
	if err = regular(before); err != nil {
		return nil, err
	}
	if q.Offset < 0 || q.Offset > before.Size {
		return nil, failure("WORKSPACE_OFFSET_INVALID")
	}
	limit := q.Limit
	if limit < 1 || limit > MaxReadBytes {
		limit = MaxReadBytes
	}
	data := make([]byte, min(int64(limit), before.Size-q.Offset))
	n, err := f.ReadAt(data, q.Offset)
	if err != nil && err != io.EOF {
		return nil, ioError(err)
	}
	after, err := statFile(f)
	if err != nil || !sameFile(before, after) {
		return nil, failure("WORKSPACE_SOURCE_CHANGED")
	}
	data = data[:n]
	return map[string]any{"path": q.Path, "data_base64": base64.StdEncoding.EncodeToString(data), "offset": q.Offset, "next_offset": q.Offset + int64(n), "size_bytes": fmtSize(before.Size), "has_more": q.Offset+int64(n) < before.Size, "identity": identity(before)}, nil
}

func (e *Engine) write(ctx context.Context, r *root, q Request) (any, bool, error) {
	name, err := Normalize(q.Path, false)
	if err != nil {
		return nil, false, err
	}
	if reserved(name) {
		return nil, false, failure("WORKSPACE_PATH_PROTECTED")
	}
	data, err := base64.StdEncoding.DecodeString(q.Data)
	if err != nil || len(data) > MaxWriteBytes {
		return nil, false, failure("WORKSPACE_CONTENT_INVALID")
	}
	if q.Operation == "edit" {
		if q.Pattern == "" || !utf8.Valid(data) {
			return nil, false, failure("WORKSPACE_EDIT_INVALID")
		}
		f, openErr := r.open(name, unix.O_RDONLY|unix.O_NONBLOCK, 0)
		if openErr != nil {
			return nil, false, openErr
		}
		st, statErr := statFile(f)
		if statErr == nil {
			statErr = regular(st)
		}
		var old []byte
		if statErr == nil {
			old, statErr = readBounded(ctx, f, MaxReadBytes)
		}
		_ = f.Close()
		if statErr != nil {
			return nil, false, statErr
		}
		if !utf8.Valid(old) || bytes.Count(old, []byte(q.Pattern)) != 1 {
			return nil, false, failure("WORKSPACE_EDIT_NOT_UNIQUE")
		}
		data = bytes.Replace(old, []byte(q.Pattern), data, 1)
		if len(data) > MaxReadBytes {
			return nil, false, failure("WORKSPACE_FILE_TOO_LARGE")
		}
		q.Identity, q.Overwrite = identity(st), true
	}
	changed, err := e.atomicWrite(r, name, bytes.NewReader(data), int64(len(data)), q.Overwrite, q.Identity)
	hash := sha256.Sum256(data)
	return map[string]any{"path": name, "size_bytes": fmtSize(int64(len(data))), "sha256": hex.EncodeToString(hash[:])}, changed, err
}

func (e *Engine) atomicWrite(r *root, name string, src io.Reader, length int64, overwrite bool, expectedIdentity string) (bool, error) {
	if length < 0 || length > MaxFileBytes {
		return false, failure("WORKSPACE_FILE_TOO_LARGE")
	}
	private, err := r.ownedDirectory(".system/staging")
	if err != nil {
		return false, err
	}
	defer func() { _ = private.Close() }()
	id, err := token()
	if err != nil {
		return false, err
	}
	staging := ".system/staging/" + id
	f, err := r.open(staging, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0600)
	if err != nil {
		return false, err
	}
	defer func() { _ = f.Close(); _ = unix.Unlinkat(int(private.Fd()), id, 0) }()
	n, err := io.Copy(f, io.LimitReader(src, length+1))
	if err != nil || n != length {
		return false, failure("WORKSPACE_TRANSFER_INCOMPLETE")
	}
	if err = f.Chown(e.UID, e.GID); err == nil {
		err = f.Chmod(0640)
	}
	if err == nil {
		err = f.Sync()
	}
	if err != nil {
		return false, ioError(err)
	}
	destination, base, err := r.parent(name)
	if err != nil {
		return false, err
	}
	defer func() { _ = destination.Close() }()
	if expectedIdentity != "" {
		var st unix.Stat_t
		if unix.Fstatat(int(destination.Fd()), base, &st, unix.AT_SYMLINK_NOFOLLOW) != nil || identity(st) != expectedIdentity {
			return false, failure("WORKSPACE_SOURCE_CHANGED")
		}
	}
	flags := uint(unix.RENAME_NOREPLACE)
	if overwrite {
		var st unix.Stat_t
		err = unix.Fstatat(int(destination.Fd()), base, &st, unix.AT_SYMLINK_NOFOLLOW)
		if err == nil && regular(st) != nil {
			return false, failure("WORKSPACE_NOT_REGULAR_FILE")
		}
		if err != nil && !errors.Is(err, unix.ENOENT) {
			return false, ioError(err)
		}
		flags = 0
	}
	if err = unix.Renameat2(int(private.Fd()), id, int(destination.Fd()), base, flags); err != nil {
		return false, ioError(err)
	}
	if err = destination.Sync(); err != nil {
		return true, ioError(err)
	}
	return true, nil
}

func (e *Engine) remove(ctx context.Context, r *root, q Request) (any, bool, error) {
	name, err := Normalize(q.Path, false)
	if err != nil {
		return nil, false, err
	}
	if reserved(name) || !validHash(q.Identity) {
		return nil, false, failure("WORKSPACE_REMOVE_INVALID")
	}
	parent, base, err := r.parent(name)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = parent.Close() }()
	var before unix.Stat_t
	if err = unix.Fstatat(int(parent.Fd()), base, &before, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return nil, false, ioError(err)
	}
	if identity(before) != q.Identity {
		return nil, false, failure("WORKSPACE_ENTRY_CHANGED")
	}
	if before.Mode&unix.S_IFMT == unix.S_IFDIR && !q.Recursive {
		dir, openErr := r.open(name, unix.O_RDONLY|unix.O_DIRECTORY, 0)
		if openErr != nil {
			return nil, false, openErr
		}
		entries, readErr := dir.Readdirnames(1)
		_ = dir.Close()
		if len(entries) > 0 || readErr != io.EOF {
			return nil, false, failure("WORKSPACE_DIRECTORY_NOT_EMPTY")
		}
	}
	private, err := r.ownedDirectory(".system/trash")
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = private.Close() }()
	id, err := token()
	if err != nil {
		return nil, false, err
	}
	if err = unix.Renameat2(int(parent.Fd()), base, int(private.Fd()), id, unix.RENAME_NOREPLACE); err != nil {
		return nil, false, ioError(err)
	}
	var moved unix.Stat_t
	err = unix.Fstatat(int(private.Fd()), id, &moved, unix.AT_SYMLINK_NOFOLLOW)
	if err != nil || moved.Dev != before.Dev || moved.Ino != before.Ino || moved.Mode != before.Mode || moved.Size != before.Size || moved.Mtim != before.Mtim {
		restore := unix.Renameat2(int(private.Fd()), id, int(parent.Fd()), base, unix.RENAME_NOREPLACE)
		return nil, restore != nil, failure("WORKSPACE_ENTRY_CHANGED")
	}
	budget := MaxWalkEntries
	err = removeAt(ctx, int(private.Fd()), id, &budget)
	if err == nil {
		err = private.Sync()
	}
	return map[string]any{"path": name, "removed": err == nil}, true, err
}

func removeAt(ctx context.Context, parent int, name string, budget *int) error {
	if ctx.Err() != nil || *budget <= 0 {
		return failure("WORKSPACE_REMOVE_INCOMPLETE")
	}
	*budget--
	var st unix.Stat_t
	if err := unix.Fstatat(parent, name, &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return ioError(err)
	}
	if st.Mode&unix.S_IFMT != unix.S_IFDIR {
		return ioError(unix.Unlinkat(parent, name, 0))
	}
	fd, err := unix.Openat(parent, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return ioError(err)
	}
	f := os.NewFile(uintptr(fd), name)
	defer func() { _ = f.Close() }()
	for {
		names, readErr := f.Readdirnames(100)
		if readErr != nil && readErr != io.EOF {
			return ioError(readErr)
		}
		for _, child := range names {
			if err = removeAt(ctx, fd, child, budget); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			break
		}
	}
	return ioError(unix.Unlinkat(parent, name, unix.AT_REMOVEDIR))
}
