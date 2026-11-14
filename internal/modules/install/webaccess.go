package install

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func (s *Service) WebAccessSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "webaccess/") {
		return "", errors.New("invalid web retrieval secret purpose")
	}
	return s.resourceSecret("webaccess", purpose, value, seal)
}
func (s *Service) WebAccessETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "webaccess-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
