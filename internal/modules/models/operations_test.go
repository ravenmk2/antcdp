package models

import (
	"encoding/json"
	"testing"
	"time"
)

func TestTestResultRejectsMalformedObservations(t *testing.T) {
	for _, raw := range []string{`{"diagnostic":{"status":"queued"}}`, `{"diagnostic":{"status":"succeeded","checks":[{"status":"wrong"}]}}`, `{"diagnostic":{"status":"succeeded","usage":{"input_tokens":-1}}}`, `{"diagnostic":{"status":"succeeded","capabilities":{"text_input":"invented"}}}`} {
		if _, err := sanitizeTestResult("model_probe", json.RawMessage(raw), time.Now(), time.Now()); err == nil {
			t.Fatal("accepted invalid observation", raw)
		}
	}
}
