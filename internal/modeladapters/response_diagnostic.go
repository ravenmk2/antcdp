package modeladapters

import (
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

// Codes describe the failed contract, never provider-controlled values or bodies.
func invalidResponse(code string) error {
	return diagnostic.With(modelcore.ErrInvalidResponse, diagnostic.Detail{Source: "model", Stage: "response_decode", Code: code})
}
