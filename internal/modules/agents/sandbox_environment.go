package agents

import (
	"context"
	"strings"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func (s *CloudService) NetworkPresets(ctx context.Context, raw string) (*Result, error) {
	return s.cloudAccess(ctx, raw, true, func(_ identity.Tx, _ Repository, _ StateRepository, _ CloudRepository, _ *identity.Auth, out *Result) error {
		out.Data = map[string]any{"items": sandboxcore.Presets(), "catalog_version": sandboxcore.PresetCatalogVersion()}
		return nil
	})
}

func normalizeCloudEnvironment(w *CloudEnvironment) error {
	w.Image = strings.TrimSpace(w.Image)
	image := w.Image
	if image == "" || len(image) > 512 || strings.ContainsAny(image, " \t\n\r\x00") || strings.HasSuffix(image, ":latest") || !strings.Contains(image, "@sha256:") && !strings.Contains(image[strings.LastIndex(image, "/")+1:], ":") {
		return httpx.Invalid("environment.image", "fixed_version_required")
	}
	if w.CPU == 0 {
		w.CPU = 2000
	}
	if w.Memory == 0 {
		w.Memory = 4096
	}
	if w.CPU < 100 || w.CPU > 32000 || w.Memory < 128 || w.Memory > 65536 {
		return httpx.Invalid("environment", "invalid_resources")
	}
	network, e := sandboxcore.NormalizePolicy(sandboxcore.NetworkPolicy(w.Network))
	if e != nil {
		return sandboxFailure(e)
	}
	w.Network = NetworkPolicy(network)
	return nil
}
