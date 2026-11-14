//go:build linux

package workspacefs

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

type root struct{ fd int }

var idPattern = regexp.MustCompile(`^[1-9][0-9]{0,19}$`)

func validID(v string) bool { return idPattern.MatchString(v) }
func validToken(v string) bool {
	if len(v) != 32 || strings.ToLower(v) != v {
		return false
	}
	_, err := hex.DecodeString(v)
	return err == nil
}
func validHash(v string) bool {
	if len(v) != 64 || strings.ToLower(v) != v {
		return false
	}
	_, err := hex.DecodeString(v)
	return err == nil
}

func openRoot(name string) (*root, error) {
	fd, err := unix.Open(name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ioError(err)
	}
	return &root{fd: fd}, nil
}
func (r *root) close() { _ = unix.Close(r.fd) }
func (r *root) open(name string, flags int, mode uint32) (*os.File, error) {
	if _, err := Normalize(name, true); err != nil {
		return nil, err
	}
	fd, err := unix.Openat2(r.fd, name, &unix.OpenHow{
		Flags: uint64(flags | unix.O_NOFOLLOW | unix.O_CLOEXEC), Mode: uint64(mode),
		Resolve: unix.RESOLVE_BENEATH | unix.RESOLVE_NO_SYMLINKS | unix.RESOLVE_NO_MAGICLINKS | unix.RESOLVE_NO_XDEV,
	})
	if err != nil {
		if errors.Is(err, unix.ENOSYS) || errors.Is(err, unix.EINVAL) {
			return nil, failure("WORKSPACE_SAFE_IO_UNSUPPORTED")
		}
		return nil, ioError(err)
	}
	return os.NewFile(uintptr(fd), name), nil
}
func (r *root) parent(name string) (*os.File, string, error) {
	if _, err := Normalize(name, false); err != nil {
		return nil, "", err
	}
	f, err := r.open(path.Dir(name), unix.O_RDONLY|unix.O_DIRECTORY, 0)
	return f, path.Base(name), err
}
func ioError(err error) error {
	if err == nil {
		return nil
	}
	switch {
	case errors.Is(err, unix.ENOENT):
		return failure("WORKSPACE_PATH_NOT_FOUND")
	case errors.Is(err, unix.EEXIST), errors.Is(err, unix.ENOTEMPTY):
		return failure("WORKSPACE_PATH_EXISTS")
	case errors.Is(err, unix.ELOOP), errors.Is(err, unix.EXDEV), errors.Is(err, unix.ENOTDIR):
		return failure("WORKSPACE_UNSAFE_PATH")
	case errors.Is(err, unix.EACCES), errors.Is(err, unix.EPERM):
		return failure("WORKSPACE_PERMISSION_DENIED")
	default:
		return failure("WORKSPACE_IO_FAILED")
	}
}
func token() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
func statFile(f *os.File) (unix.Stat_t, error) {
	var st unix.Stat_t
	err := unix.Fstat(int(f.Fd()), &st)
	return st, ioError(err)
}
func identity(st unix.Stat_t) string {
	s := fmt.Sprintf("%d:%d:%d:%d:%d:%d:%d:%d:%d", st.Dev, st.Ino, st.Mode, st.Size, st.Mtim.Sec, st.Mtim.Nsec, st.Ctim.Sec, st.Ctim.Nsec, st.Nlink)
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}
func sameFile(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Size == b.Size && a.Mode == b.Mode && a.Mtim == b.Mtim && a.Ctim == b.Ctim
}
func regular(st unix.Stat_t) error {
	if st.Mode&unix.S_IFMT != unix.S_IFREG || st.Nlink != 1 {
		return failure("WORKSPACE_NOT_REGULAR_FILE")
	}
	return nil
}
func (r *root) mkdirs(name string, uid, gid int, mode uint32) (bool, error) {
	if _, err := Normalize(name, false); err != nil {
		return false, err
	}
	changed := false
	current := ""
	for _, part := range strings.Split(name, "/") {
		current = path.Join(current, part)
		parent, base, err := r.parent(current)
		if err != nil {
			return changed, err
		}
		err = unix.Mkdirat(int(parent.Fd()), base, mode)
		_ = parent.Close()
		created := err == nil
		if err != nil && !errors.Is(err, unix.EEXIST) {
			return changed, ioError(err)
		}
		f, err := r.open(current, unix.O_RDONLY|unix.O_DIRECTORY, 0)
		if err != nil {
			return changed || created, err
		}
		if created {
			changed = true
			err = f.Chown(uid, gid)
			if err == nil {
				err = f.Chmod(os.FileMode(mode))
			}
		}
		_ = f.Close()
		if err != nil {
			return changed, ioError(err)
		}
	}
	return changed, nil
}
func (r *root) ownedDirectory(name string) (*os.File, error) {
	if strings.HasPrefix(name, ".system/") {
		base, e := r.ownedDirectory(".system")
		if e != nil {
			return nil, e
		}
		_ = base.Close()
	}
	parent, base, err := r.parent(name)
	if err != nil {
		return nil, err
	}
	err = unix.Mkdirat(int(parent.Fd()), base, 0700)
	_ = parent.Close()
	if err != nil && !errors.Is(err, unix.EEXIST) {
		return nil, ioError(err)
	}
	f, err := r.open(name, unix.O_RDONLY|unix.O_DIRECTORY, 0)
	if err != nil {
		return nil, err
	}
	st, err := statFile(f)
	if err != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&0777 != 0700 {
		_ = f.Close()
		return nil, failure("WORKSPACE_PRIVATE_DIRECTORY_INVALID")
	}
	return f, nil
}

func (e *Engine) Handle(ctx context.Context, q Request) Response {
	if q.Version != Version || ctx.Err() != nil {
		return Result(nil, false, failure("WORKSPACE_REQUEST_INVALID"))
	}
	if q.Operation == "capabilities" {
		return e.capabilities()
	}
	if q.Operation == "verify_security" {
		return e.verifySecurity(ctx)
	}
	r, err := openRoot(e.WorkspaceRoot)
	if err != nil {
		return Result(nil, false, err)
	}
	defer r.close()
	var rootStat unix.Stat_t
	if unix.Fstat(r.fd, &rootStat) != nil || rootStat.Uid != uint32(os.Geteuid()) || rootStat.Mode&0022 != 0 {
		return Result(nil, false, failure("WORKSPACE_ROOT_UNSAFE"))
	}
	var value any
	var changed bool
	switch q.Operation {
	case "initialize":
		value, changed, err = e.initialize(r, q)
	case "list":
		value, err = e.list(r, q)
	case "read":
		value, err = e.read(r, q)
	case "write", "edit":
		value, changed, err = e.write(ctx, r, q)
	case "mkdir":
		if reserved(q.Path) {
			err = failure("WORKSPACE_PATH_PROTECTED")
		} else {
			changed, err = r.mkdirs(q.Path, e.UID, e.GID, 0750)
			value = map[string]any{"path": q.Path}
		}
	case "remove":
		value, changed, err = e.remove(ctx, r, q)
	case "transfer_begin", "transfer_cleanup", "export", "import":
		value, changed, err = e.transfer(ctx, r, q)
	case "glob", "grep":
		value, err = e.search(ctx, r, q)
	case "skills_install":
		value, changed, err = e.installSkills(ctx, r, q)
	default:
		err = failure("WORKSPACE_OPERATION_INVALID")
	}
	return Result(value, changed, err)
}
func (e *Engine) capabilities() Response {
	r, err := openRoot(e.WorkspaceRoot)
	if err != nil {
		return Result(nil, false, err)
	}
	defer r.close()
	f, err := r.open(".", unix.O_RDONLY|unix.O_DIRECTORY, 0)
	if err == nil {
		_ = f.Close()
	}
	return Result(map[string]any{"protocol": Version, "safe_io": "openat2", "uid": os.Geteuid(), "workspace_uid": e.UID}, false, err)
}
func (e *Engine) initialize(r *root, q Request) (any, bool, error) {
	if q.AgentID != "" && !validID(q.AgentID) || q.ProjectID != "" && !validID(q.ProjectID) {
		return nil, false, failure("WORKSPACE_REQUEST_INVALID")
	}
	dirs := []string{"home/.config", "home/.local", "home/.cache", "workspace", "projects"}
	if q.ProjectID != "" {
		dirs = append(dirs, "projects/"+q.ProjectID)
	}
	changed := false
	for _, dir := range dirs {
		c, err := r.mkdirs(dir, e.UID, e.GID, 0750)
		changed = changed || c
		if err != nil {
			return nil, changed, err
		}
	}
	// Neither the workload nor its writable HOME can replace the skill tree.
	protected := []string{"agents"}
	if q.AgentID != "" {
		protected = append(protected, "agents/"+q.AgentID, "agents/"+q.AgentID+"/skills")
	}
	for _, dir := range protected {
		c, err := r.mkdirs(dir, os.Geteuid(), os.Getegid(), 0755)
		changed = changed || c
		if err != nil {
			return nil, changed, err
		}
		f, err := r.open(dir, unix.O_RDONLY|unix.O_DIRECTORY, 0)
		if err != nil {
			return nil, changed, err
		}
		st, err := statFile(f)
		_ = f.Close()
		if err != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&0022 != 0 {
			return nil, changed, failure("WORKSPACE_SKILL_DIRECTORY_UNSAFE")
		}
	}
	private, err := r.ownedDirectory(".system")
	if err != nil {
		return nil, changed, err
	}
	_ = private.Close()
	cwd := "/data/workspace"
	if q.ProjectID != "" {
		cwd = "/data/projects/" + q.ProjectID
	}
	return map[string]any{"cwd": cwd}, changed, nil
}
func entry(name, pathname string, st unix.Stat_t) Entry {
	kind := "unsupported"
	switch st.Mode & unix.S_IFMT {
	case unix.S_IFDIR:
		kind = "directory"
	case unix.S_IFREG:
		kind = "file"
	case unix.S_IFLNK:
		kind = "symlink"
	}
	return Entry{Name: name, Path: pathname, Kind: kind, Size: st.Size, ModifiedAt: time.Unix(st.Mtim.Sec, st.Mtim.Nsec).UTC().Format(time.RFC3339Nano), Identity: identity(st)}
}
func readBounded(ctx context.Context, f *os.File, limit int64) ([]byte, error) {
	b, err := io.ReadAll(io.LimitReader(contextReader{ctx: ctx, r: f}, limit+1))
	if err != nil {
		return nil, ioError(err)
	}
	if int64(len(b)) > limit {
		return nil, failure("WORKSPACE_FILE_TOO_LARGE")
	}
	return b, nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}
