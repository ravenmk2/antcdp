//go:build linux

package workspacefs

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path"

	"github.com/ravenmk2/antcdp/internal/skillpackage"
	"golang.org/x/sys/unix"
)

func (e *Engine) installSkills(ctx context.Context, r *root, q Request) (any, bool, error) {
	if !validID(q.AgentID) || !validToken(q.Token) || !validHash(q.ExpectedHash) || !validHash(q.SkillSetHash) || len(q.Skills) > 32 {
		return nil, false, failure("SKILL_REQUEST_INVALID")
	}
	transfer, err := e.transferRoot()
	if err != nil {
		return nil, false, err
	}
	defer transfer.close()
	payload, err := transfer.open(q.Token+"/payload", unix.O_RDONLY|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = payload.Close() }()
	stat, err := statFile(payload)
	if err != nil || regular(stat) != nil || stat.Size < 1 || stat.Size > MaxFileBytes {
		return nil, false, failure("SKILL_BUNDLE_INVALID")
	}
	data, err := io.ReadAll(io.LimitReader(payload, MaxFileBytes+1))
	if err != nil {
		return nil, false, err
	}
	hash := sha256.Sum256(data)
	if hex.EncodeToString(hash[:]) != q.ExpectedHash {
		return nil, false, failure("SKILL_INTEGRITY_FAILED")
	}
	bundle, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(bundle.File) != len(q.Skills) {
		return nil, false, failure("SKILL_BUNDLE_INVALID")
	}
	archives := map[string]*zip.File{}
	for _, file := range bundle.File {
		if !file.Mode().IsRegular() || file.UncompressedSize64 > uint64(skillpackage.MaxArchiveBytes) || archives[file.Name] != nil {
			return nil, false, failure("SKILL_BUNDLE_INVALID")
		}
		archives[file.Name] = file
	}
	private, err := r.ownedDirectory(".system/skills")
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = private.Close() }()
	if err = unix.Mkdirat(int(private.Fd()), q.Token, 0755); err != nil {
		return nil, false, ioError(err)
	}
	stage := ".system/skills/" + q.Token
	published := false
	defer func() {
		if !published {
			budget := MaxWalkEntries * 4
			_ = removeAt(context.WithoutCancel(ctx), int(private.Fd()), q.Token, &budget)
		}
	}()
	seen := map[string]bool{}
	totalFiles := 0
	var totalBytes uint64
	for _, skill := range q.Skills {
		if !skillpackage.ValidName(skill.Name) || !validHash(skill.ArchiveSHA) || !validHash(skill.ContentSHA) || seen[skill.Name] {
			return nil, false, failure("SKILL_REQUEST_INVALID")
		}
		seen[skill.Name] = true
		file := archives[skill.Name+".zip"]
		if file == nil {
			return nil, false, failure("SKILL_BUNDLE_INVALID")
		}
		reader, err := file.Open()
		if err != nil {
			return nil, false, err
		}
		archive, err := io.ReadAll(io.LimitReader(reader, skillpackage.MaxArchiveBytes+1))
		_ = reader.Close()
		if err != nil || int64(len(archive)) > skillpackage.MaxArchiveBytes {
			return nil, false, failure("SKILL_BUNDLE_INVALID")
		}
		err = skillpackage.Unpack(ctx, bytes.NewReader(archive), int64(len(archive)), skill.Name, skill.ArchiveSHA, skill.ContentSHA, func(entry skillpackage.Entry, contents []byte) error {
			totalFiles++
			totalBytes += entry.Size
			if totalFiles > MaxWalkEntries || totalBytes > 256<<20 {
				return failure("SKILL_SET_TOO_LARGE")
			}
			target := stage + "/" + skill.Name + "/" + entry.Path
			if _, err := r.mkdirs(path.Dir(target), os.Geteuid(), os.Getegid(), 0755); err != nil {
				return err
			}
			out, err := r.open(target, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0444)
			if err != nil {
				return err
			}
			_, writeErr := out.Write(contents)
			syncErr := out.Sync()
			closeErr := out.Close()
			if writeErr != nil {
				return writeErr
			}
			if syncErr != nil {
				return syncErr
			}
			return closeErr
		})
		if err != nil {
			return nil, false, failure("SKILL_INTEGRITY_FAILED")
		}
	}
	// All package files are complete before the single atomic directory exchange.
	parent, err := r.open("agents/"+q.AgentID, unix.O_RDONLY|unix.O_DIRECTORY, 0)
	if err != nil {
		return nil, false, err
	}
	defer func() { _ = parent.Close() }()
	st, err := statFile(parent)
	if err != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&0022 != 0 {
		return nil, false, failure("WORKSPACE_SKILL_DIRECTORY_UNSAFE")
	}
	if err = unix.Renameat2(int(private.Fd()), q.Token, int(parent.Fd()), "skills", unix.RENAME_EXCHANGE); err != nil {
		return nil, false, ioError(err)
	}
	published = true
	if err = parent.Sync(); err != nil {
		return nil, true, ioError(err)
	}
	budget := MaxWalkEntries * 4
	if err = removeAt(ctx, int(private.Fd()), q.Token, &budget); err != nil {
		return nil, true, err
	}
	return map[string]any{"skill_set_hash": q.SkillSetHash, "installed": true}, true, nil
}
