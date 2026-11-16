package opensandbox

import (
	"errors"
	"net"
	"testing"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestRemoteDiagnosticKeepsUncertaintyClassification(t *testing.T) {
	for _, status := range []int{401, 403, 404, 422, 429, 503} {
		cause := &sdk.APIError{StatusCode: status}
		err := remoteError(cause, true)
		var control *sandboxcore.Error
		if !errors.As(err, &control) || control.Unknown != (status == 503) {
			t.Fatal("mutation certainty changed", status, err)
		}
		if d := diagnostic.From(err); d == nil || d.HTTPStatus != status {
			t.Fatal("status discarded", status, d)
		}
	}
	err := remoteError(&net.DNSError{Name: "private", Err: "private resolver"}, true)
	if diagnostic.From(err).Network != "dns" {
		t.Fatal("DNS classification lost")
	}
	var original *net.DNSError
	if errors.As(err, &original) {
		t.Fatal("private original error retained")
	}
}
