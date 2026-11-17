package opensandbox

import (
	"crypto/sha256"
	"fmt"
	"sync"
	"time"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

type endpointKey struct {
	connection [32]byte
	resource   sandboxcore.ResourceRef
}

type cachedEndpoint struct {
	endpoint    *sdk.Endpoint
	validatedAt time.Time
}

// Only immutable, ownership-checked addresses enter this bounded runtime cache.
// Credentials and resource generations are part of its identity, never logged.
type endpointCache struct {
	mu      sync.Mutex
	entries map[endpointKey]cachedEndpoint
}

func newEndpointCache() *endpointCache {
	return &endpointCache{entries: make(map[endpointKey]cachedEndpoint)}
}

func endpointConnectionKey(c sandboxcore.Connection) [32]byte {
	return sha256.Sum256(fmt.Appendf(nil, "%q|%q|%q|%x", c.Endpoint, c.AccessMode, c.APIKey, c.ControlKey))
}

func (p *Provider) endpointKey(ref sandboxcore.ResourceRef) endpointKey {
	return endpointKey{connection: p.connectionKey, resource: ref}
}

func (c *endpointCache) get(key endpointKey) *sdk.Endpoint {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return nil
	}
	if time.Since(entry.validatedAt) >= 15*time.Minute {
		delete(c.entries, key)
		return nil
	}
	return entry.endpoint
}

func (c *endpointCache) put(key endpointKey, endpoint *sdk.Endpoint) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= 256 {
		var oldest endpointKey
		var oldestAt time.Time
		for k, entry := range c.entries {
			if oldestAt.IsZero() || entry.validatedAt.Before(oldestAt) {
				oldest, oldestAt = k, entry.validatedAt
			}
		}
		delete(c.entries, oldest)
	}
	c.entries[key] = cachedEndpoint{endpoint: endpoint, validatedAt: time.Now()}
}

func (c *endpointCache) remove(key endpointKey, failed *sdk.Endpoint) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if failed == nil || c.entries[key].endpoint == failed {
		delete(c.entries, key)
	}
}
