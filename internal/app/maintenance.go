package app

import (
	"context"
	"log/slog"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/collaboration"
	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/modules/email"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/media"
	"github.com/ravenmk2/antcdp/internal/modules/sms"
)

func maintainAvatars(ctx context.Context, installer *install.Service, accounts *identity.Service, files, icons media.Store, logger *slog.Logger) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	var lastMediaCleanup time.Time
	for {
		if ctx.Err() != nil {
			return
		}
		work, cancel := context.WithTimeout(ctx, 30*time.Second)
		if installer.Status(work).State == install.Ready {
			cleanMedia := time.Since(lastMediaCleanup) >= time.Hour
			if cleanMedia {
				lastMediaCleanup = time.Now()
			}
			if cleanMedia {
				if err := cleanAvatars(work, accounts, files, time.Now()); err != nil && ctx.Err() == nil {
					logger.Error("avatar cleanup failed", "error", err)
				}
			}
			if store, ok := installer.Backend().(identity.Store); ok {
				for name, clean := range map[string]func(context.Context, identity.Store, time.Time) error{"email": email.Clean, "sms": sms.Clean, "dingtalk": dingtalk.Clean} {
					if err := clean(work, store, time.Now().UTC()); err != nil && ctx.Err() == nil {
						logger.Error("delivery maintenance failed", "module", name)
					}
				}
				if cleanMedia {
					if err := collaboration.CleanIcons(work, store, icons, time.Now()); err != nil && ctx.Err() == nil {
						logger.Error("icon cleanup failed", "error", err)
					}
				}
			}
		}
		cancel()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func cleanAvatars(ctx context.Context, accounts *identity.Service, files media.Store, now time.Time) error {
	rows, err := accounts.PruneAvatars(ctx)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err = files.Remove(row.Key); err != nil {
			return err
		}
	}
	candidates, err := files.Candidates(ctx, now.Add(-24*time.Hour))
	if err != nil {
		return err
	}
	for _, key := range candidates {
		exists, e := accounts.AvatarKeyExists(ctx, key)
		if e != nil {
			return e
		}
		if !exists {
			if e = files.Remove(key); e != nil {
				return e
			}
		}
	}
	return nil
}
