package agents

import (
	"context"
	"strconv"
	"time"

	"github.com/ravenmk2/antcdp/internal/agentcore"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// RefreshSessionTitle is the only retry path. It explicitly releases a manual
// title pin; an ambiguous HTTP result is resolved through the command receipt.
func (s *Service) RefreshSessionTitle(ctx context.Context, raw string, id uint64, tag, key string) (*Result, error) {
	return s.access(ctx, raw, false, func(tx identity.Tx, r Repository, a *identity.Auth, out *Result) error {
		st, err := StateFor(tx)
		if err != nil {
			return err
		}
		if _, err = s.sessionAccess(st, id, a, true, false); err != nil {
			return err
		}
		return s.sessionReceipt(ctx, tx, r, st, a, out, key, "session.title.refresh", "session:"+strconv.FormatUint(id, 10), struct{}{}, func(rec *Receipt) error {
			v, err := s.sessionAccess(st, id, a, true, true)
			if err != nil {
				return err
			}
			if err = checkTag(tag, s.tag("session", id, v.RowVersion)); err != nil {
				return err
			}
			if v.ArchivedAt != nil {
				return httpx.E(409, "SESSION_ARCHIVED", "会话已归档")
			}
			repo, ok := st.(ConversationRepository)
			if !ok {
				return unavailable()
			}
			row, err := repo.SessionTitle(id, true)
			if err != nil {
				return err
			}
			if row == nil || row.SourceSeq == 0 {
				return httpx.E(409, "TITLE_INPUT_REQUIRED", "尚无可用于自动命名的人工消息")
			}
			if row.Status == "queued" || row.Status == "running" {
				return httpx.E(409, "TITLE_GENERATION_PENDING", "会话标题正在生成")
			}
			now := time.Now().UTC().Truncate(time.Millisecond)
			row.Source, row.Status, row.ModelCallID, row.Epoch, row.UpdatedAt = "fallback", "queued", nil, "", now
			if err = repo.SaveSessionTitle(row); err != nil {
				return err
			}
			from := v.LastSeq + 1
			if err = s.commitSessionTitle(st, v, row, v.Title, now); err != nil {
				return err
			}
			if err = st.SaveSession(v); err != nil {
				return err
			}
			out.Commits = append(out.Commits, eventReceipt(id, from, v.LastSeq))
			out.Status, out.Data = 202, map[string]any{"accepted_seq": agentcore.Seq(v.LastSeq), "status": "queued"}
			kind := "session"
			rec.TargetKind, rec.TargetID = &kind, &v.ID
			return nil
		})
	})
}
