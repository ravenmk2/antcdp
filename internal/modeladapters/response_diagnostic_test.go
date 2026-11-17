package modeladapters

import (
	"errors"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/modelcore"
)

func TestChatResponseDiagnosticsKeepContractFailureWithoutPayload(t *testing.T) {
	for _, tc := range []struct{ name, body, code string }{
		{"frame", "data: private-malformed-body\n\n", "MODEL_STREAM_FRAME_INVALID"},
		{"remote error", "data: {\"error\":{\"message\":\"private-provider-error\"}}\n\n", "MODEL_STREAM_ERROR_FRAME"},
		{"tool type", strings.Replace(chatToolStream, `"type":"function"`, `"type":"private-tool-kind"`, 1), "MODEL_TOOL_TYPE_INVALID"},
		{"tool arguments", strings.Replace(chatToolStream, `\"OK\"}`, `\"private-malformed-argument\"`, 1), "MODEL_TOOL_ARGUMENTS_NOT_OBJECT"},
		{"finish", strings.Replace(chatToolStream, `"finish_reason":"tool_calls"`, `"finish_reason":"private-finish"`, 1), "MODEL_FINISH_REASON_INVALID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := decodeChat(t.Context(), strings.NewReader(tc.body), func(modelcore.Delta) error { return nil })
			detail := diagnostic.From(err)
			if !errors.Is(err, modelcore.ErrInvalidResponse) || detail == nil || detail.Stage != "response_decode" || detail.Code != tc.code {
				t.Fatalf("err=%v diagnostic=%+v", err, detail)
			}
			if strings.Contains(err.Error(), "private-") {
				t.Fatal("provider data escaped into error")
			}
		})
	}
}
