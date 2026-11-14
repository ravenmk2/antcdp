package identity

import (
	"context"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/audit"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) Events(ctx context.Context, raw string, f audit.Filter) ([]Event, int, *Auth, error) {
	f.Query = strings.TrimSpace(f.Query)
	if err := f.Validate(); err != nil {
		return nil, 0, nil, err
	}
	var events []Event
	var total int
	a, err := s.execute(ctx, raw, policy{admin: true, renew: true}, 0, func(tx Tx, _ *Auth, _ *User) error {
		var e error
		events, total, e = tx.AuditEvents(f)
		return e
	})
	return events, total, a, err
}
func (s *Service) Event(ctx context.Context, raw string, id uint64) (*Event, *Auth, error) {
	var event *Event
	a, err := s.execute(ctx, raw, policy{admin: true, renew: true}, 0, func(tx Tx, _ *Auth, _ *User) error {
		var e error
		event, e = tx.AuditEvent(id)
		if e == nil && event == nil {
			return httpx.E(404, "NOT_FOUND", "审计记录不存在")
		}
		return e
	})
	return event, a, err
}
