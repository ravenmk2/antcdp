package sms

import (
	"context"
	"fmt"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func (s *Service) Simulate(ctx context.Context, raw string, id uint64, tag string, params map[string]any, meta identity.Metadata) (Result, *identity.Auth, error) {
	select {
	case sendSlots <- struct{}{}:
		defer func() { <-sendSlots }()
	default:
		return Result{}, nil, httpx.E(429, "RATE_LIMITED", "短信模拟繁忙")
	}
	var out Result
	a, err := s.access(ctx, raw, func(tx identity.Tx, r Repository, a *identity.Auth) error {
		t, err := r.Template(id)
		if err != nil {
			return err
		}
		if t == nil {
			return missing()
		}
		if err = checkTag(tag, s.tag("template", id, t.RowVersion)); err != nil {
			return err
		}
		if t.Mode != "local" || !t.Enabled {
			return httpx.E(409, "RESOURCE_DISABLED", "仅启用的本地模板可以模拟")
		}
		content, err := Render(*t, params)
		if err != nil {
			return err
		}
		if !s.allowSimulation(a.User.ID, id) {
			return httpx.E(429, "RATE_LIMITED", "每分钟最多模拟五次")
		}
		summary := &Simulation{TestID: cryptox.ID(), Status: "rendered", StartedAt: time.Now().UTC(), TemplateVersion: t.RowVersion}
		if err = r.SaveSimulation(id, summary); err != nil {
			return err
		}
		out.Data = map[string]any{"body": content.Body, "status": "rendered", "summary": summary}
		return audit(tx, a, "template", id, t.Name, "simulated", meta)
	})
	return out, a, err
}

func (s *Service) allowSimulation(actor, id uint64) bool {
	s.simulationMu.Lock()
	defer s.simulationMu.Unlock()
	if s.recentSimulations == nil {
		s.recentSimulations = map[string][]time.Time{}
	}
	now := time.Now()
	for key, list := range s.recentSimulations {
		next := list[:0]
		for _, v := range list {
			if now.Sub(v) < time.Minute {
				next = append(next, v)
			}
		}
		if len(next) == 0 {
			delete(s.recentSimulations, key)
		} else {
			s.recentSimulations[key] = next
		}
	}
	keys := []string{fmt.Sprint("actor/", actor), fmt.Sprint("template/", id)}
	for _, key := range keys {
		if len(s.recentSimulations[key]) >= 5 {
			return false
		}
	}
	for _, key := range keys {
		s.recentSimulations[key] = append(s.recentSimulations[key], now)
	}
	return true
}
