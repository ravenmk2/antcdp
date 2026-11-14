package install

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

// ModelSecret binds model credentials to the installation and their resource.
func (s *Service) ModelSecret(purpose, value string, seal bool) (string, error) {
	if !strings.HasPrefix(purpose, "models/") {
		return "", errors.New("invalid model secret purpose")
	}
	return s.resourceSecret("models", purpose, value, seal)
}

// ModelETag keeps model editing versions separate from other module versions.
func (s *Service) ModelETag(value string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	mac := hmac.New(sha256.New, cryptox.Derive(s.key, "models-etags"))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
