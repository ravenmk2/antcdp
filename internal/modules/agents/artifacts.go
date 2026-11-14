package agents

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) artifactView(st StateRepository, row *ArtifactRow) (ArtifactView, error) {
	file, e := st.File(row.FileID, false)
	if e != nil {
		return ArtifactView{}, e
	}
	if file == nil || file.SizeBytes == nil || len(file.SHA256) != 32 {
		return ArtifactView{}, integrity()
	}
	var source ArtifactSource
	if json.Unmarshal(row.SourceSnapshot, &source) != nil {
		return ArtifactView{}, integrity()
	}
	source.Path = row.SourcePath
	return ArtifactView{ID: row.ID, SessionID: row.ContentSessionID, RunID: row.RunID, ToolCallID: row.ToolCallID, FileID: row.FileID, Filename: row.Filename, Description: row.Description, MediaType: file.MediaType, Size: *file.SizeBytes, SHA256: hexHash(file.SHA256), Source: source, CreatedAt: row.CreatedAt, DeletedAt: row.DeletedAt, Version: strings.Trim(s.tag("artifact", row.ID, row.RowVersion), `"`)}, nil
}
func (s *Service) ListArtifacts(ctx context.Context, raw string, session uint64, run *uint64, q ArtifactQuery) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		base := Query{Page: q.Page, PageSize: q.PageSize, Q: q.Q}
		if e := validateQuery(&base); e != nil {
			return e
		}
		q.Page, q.PageSize, q.Q = base.Page, base.PageSize, base.Q
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		if run != nil {
			row, e := st.Run(*run, false)
			if e != nil {
				return e
			}
			if row == nil {
				return missing()
			}
			v, e := s.sessionAccess(st, row.SessionID, a, false, false)
			if e != nil {
				return e
			}
			session = v.ID
			if v.RootSessionID != nil {
				session = *v.RootSessionID
			}
		} else {
			v, e := s.sessionAccess(st, session, a, false, false)
			if e != nil {
				return e
			}
			if v.RootSessionID != nil {
				session = *v.RootSessionID
			}
		}
		rows, n, e := st.Artifacts(session, run, q)
		if e != nil {
			return e
		}
		items := []ArtifactView{}
		for i := range rows {
			v, e := s.artifactView(st, &rows[i])
			if e != nil {
				return e
			}
			items = append(items, v)
		}
		out.Data = items
		out.Pagination = &Pagination{Page: q.Page, PageSize: q.PageSize, Total: n}
		return nil
	})
}
func (s *Service) GetArtifact(ctx context.Context, raw string, id uint64) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, _ Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		row, e := st.Artifact(id, false)
		if e != nil {
			return e
		}
		if row == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, row.ContentSessionID, a, false, false); e != nil {
			return e
		}
		out.Data, e = s.artifactView(st, row)
		out.Tag = s.tag("artifact", id, row.RowVersion)
		return e
	})
}
func (s *Service) DeleteArtifact(ctx context.Context, raw string, id uint64, tag, key string) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, e := StateFor(tx)
		if e != nil {
			return e
		}
		initial, e := st.Artifact(id, false)
		if e != nil {
			return e
		}
		if initial == nil {
			return missing()
		}
		if _, e = s.sessionAccess(st, initial.ContentSessionID, a, true, false); e != nil {
			return e
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "artifact.delete", "artifact:"+strconv.FormatUint(id, 10), struct{}{}, func(rec *Receipt) error {
			v, e := s.sessionAccess(st, initial.ContentSessionID, a, true, true)
			if e != nil {
				return e
			}
			if v.ArchivedAt != nil {
				return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
			}
			file, e := st.File(initial.FileID, true)
			if e != nil {
				return e
			}
			if file == nil {
				return integrity()
			}
			row, e := st.Artifact(id, true)
			if e != nil {
				return e
			}
			if row == nil {
				return missing()
			}
			if e = checkTag(tag, s.tag("artifact", id, row.RowVersion)); e != nil {
				return e
			}
			if row.DeletedAt == nil {
				n, e := st.FileActiveReferences(file.ID)
				if e != nil {
					return e
				}
				if n > 0 {
					return httpx.E(409, "FILE_IN_USE", "文件仍有在途读取")
				}
				now := time.Now().UTC().Truncate(time.Millisecond)
				row.DeletedAt = &now
				row.DeletedByUserID = &a.User.ID
				row.RowVersion++
				user := agentcore.ID(a.User.ID)
				seq, e := appendEvent(st, v, nil, "artifact/deleted", "", map[string]any{"artifact_id": agentcore.ID(row.ID), "deleted_at": now, "actor_ref": agentcore.ActorRef{Kind: "user", ID: &user}}, nil, now)
				if e != nil {
					return e
				}
				row.DeletedEventSeq = &seq
				if e = st.SaveArtifact(row); e != nil {
					return e
				}
				bound, e := st.FileHasBindings(file.ID)
				if e != nil {
					return e
				}
				if !bound {
					file.State = "orphaned"
					file.OrphanedAt, file.ExpiresAt = &now, &now
					file.UpdatedAt = now
					if e = st.SaveFile(file); e != nil {
						return e
					}
				}
				if e = st.SaveSession(v); e != nil {
					return e
				}
				out.Commits = append(out.Commits, eventReceipt(v.ID, seq, seq))
			}
			out.Status = 204
			kind := "session"
			rec.TargetKind = &kind
			rec.TargetID = &v.ID
			return nil
		})
	})
}
