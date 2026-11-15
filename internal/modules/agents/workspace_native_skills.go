package agents

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"path"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/agents/workspace"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
	"github.com/ravenmk2/antcdp/internal/skillpackage"
)

// Validate every archive before changing the sandbox. Expanded data stays bounded;
// the sandbox only needs ordinary directory, upload and rename APIs.
func installNativeSkills(ctx context.Context, a *SandboxAccess, q workspace.Request, bundle []byte) (response workspace.Response, cause error) {
	if !validNumericID(q.AgentID) || a.WorkspaceOperationID == 0 {
		return workspace.Response{}, integrity()
	}
	fs, err := nativeFiles(a)
	if err != nil {
		return workspace.Response{}, err
	}
	z, err := zip.NewReader(bytes.NewReader(bundle), int64(len(bundle)))
	if err != nil || len(z.File) != len(q.Skills) {
		return workspace.Response{}, integrity()
	}
	type entry struct {
		name string
		data []byte
	}
	entries := []entry{}
	total := 0
	for i, skill := range q.Skills {
		if !skillpackage.ValidName(skill.Name) || z.File[i].Name != skill.Name+".zip" {
			return workspace.Response{}, integrity()
		}
		stream, e := z.File[i].Open()
		if e != nil {
			return workspace.Response{}, e
		}
		archive, e := io.ReadAll(io.LimitReader(stream, skillpackage.MaxArchiveBytes+1))
		closeErr := stream.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			return workspace.Response{}, e
		}
		e = skillpackage.Unpack(ctx, bytes.NewReader(archive), int64(len(archive)), skill.Name, skill.ArchiveSHA, skill.ContentSHA, func(v skillpackage.Entry, data []byte) error {
			total += len(data)
			if total > 256<<20 || len(entries) >= 10000 {
				return nativeError("SKILL_SET_TOO_LARGE")
			}
			entries = append(entries, entry{path.Join(skill.Name, v.Path), data})
			return nil
		})
		if e != nil {
			return workspace.Response{}, e
		}
	}
	// The operation ID is generated internally, never from archive names.
	root := "/data/agents/" + q.AgentID
	staging := "/data/.system/skills/" + q.AgentID + "/" + idString(a.WorkspaceOperationID)
	target := root + "/skills"
	backup := staging + "-previous"
	hadPrevious, published := false, false
	// No cleanup or rollback races an uncertain remote mutation. For a known
	// failure, restore the previous stable directory before retiring our staging.
	defer func() {
		if cause == nil || nativeUncertain(cause) {
			return
		}
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancel()
		if hadPrevious && !published {
			if e := fs.MoveFile(cleanup, a.Resource, backup, target); e != nil {
				cause = &sandboxcore.Error{Code: "SKILL_RESTORE_UNCONFIRMED", Unknown: true}
				return
			}
		}
		if !published {
			if e := fs.RemoveFile(cleanup, a.Resource, staging, true); e != nil && !nativeMissing(e) {
				cause = &sandboxcore.Error{Code: "SKILL_CLEANUP_UNCONFIRMED", Unknown: true}
			}
		}
	}()
	if err = fs.MakeDirectory(ctx, a.Resource, staging, 755); err != nil {
		return workspace.Response{}, err
	}
	dirs := map[string]bool{staging: true}
	for _, v := range entries {
		name := path.Join(staging, v.name)
		parent := path.Dir(name)
		if !dirs[parent] {
			if err = fs.MakeDirectory(ctx, a.Resource, parent, 755); err != nil {
				return workspace.Response{}, err
			}
			dirs[parent] = true
		}
		if err = fs.PutFile(ctx, a.Resource, sandboxcore.FileRequest{Path: name, MaxBytes: int64(max(1, len(v.data))), Mode: 644}, bytes.NewReader(v.data)); err != nil {
			return workspace.Response{}, err
		}
	}
	if _, err = fs.StatFile(ctx, a.Resource, target); err == nil {
		if err = fs.MoveFile(ctx, a.Resource, target, backup); err != nil {
			return workspace.Response{}, err
		}
		hadPrevious = true
	} else if !nativeMissing(err) {
		return workspace.Response{}, err
	}
	if err = fs.MoveFile(ctx, a.Resource, staging, target); err != nil {
		return workspace.Response{}, err
	}
	published = true
	if hadPrevious {
		if err = fs.RemoveFile(ctx, a.Resource, backup, true); err != nil {
			return workspace.Response{}, err
		}
	}
	return workspace.Result(map[string]any{"installed": true, "skill_set_hash": q.SkillSetHash}, true, nil), nil
}
