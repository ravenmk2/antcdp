package diagnostic_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strings"
	"testing"

	"github.com/ravenmk2/antcdp/internal/diagnostic"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func TestDiagnosticNeverChangesControlError(t *testing.T) {
	original := &sandboxcore.Error{Code: "SANDBOX_OPERATION_TIMEOUT", Unknown: true, Detail: &diagnostic.Detail{Network: "timeout"}}
	wrapped := diagnostic.With(fmt.Errorf("private wrapper: %w", original), diagnostic.Detail{Source: "sandbox", Stage: "create", OperationID: "42"})
	var remote *sandboxcore.Error
	if !errors.Is(wrapped, original) || !errors.As(wrapped, &remote) || !remote.Unknown {
		t.Fatal("diagnostic changed control semantics")
	}
	d := diagnostic.From(wrapped)
	if d.Stage != "create" || d.Network != "timeout" || d.OperationID != "42" {
		t.Fatal(d)
	}
	raw, err := json.Marshal(d)
	if err != nil || strings.Contains(string(raw), "private") {
		t.Fatal("private error leaked", err)
	}
	d.Stage = "changed"
	if diagnostic.From(wrapped).Stage != "create" {
		t.Fatal("caller mutated stored facts")
	}
}

func TestObservationExtensionPreservesLegacyFields(t *testing.T) {
	raw := json.RawMessage(`{"state":"unknown","ref":{"id":"old"}}`)
	d := &diagnostic.Detail{Stage: "create", HTTPStatus: 503, Code: "SANDBOX_UNAVAILABLE"}
	extended, err := diagnostic.Put(raw, d)
	if err != nil {
		t.Fatal(err)
	}
	var old struct {
		State string
		Ref   struct{ ID string }
	}
	if json.Unmarshal(extended, &old) != nil || old.State != "unknown" || old.Ref.ID != "old" {
		t.Fatal("old observation contract changed")
	}
	if diagnostic.Read(raw) != nil || *diagnostic.Read(extended) != *d {
		t.Fatal("legacy or new read failed")
	}
	if got := diagnostic.Copy(&diagnostic.Detail{Stage: "https://private", Code: strings.Repeat("x", 100), Network: "private", HTTPStatus: 999}); got != nil {
		t.Fatal("unbounded fields retained", got)
	}
}

func TestNetworkClassificationDoesNotIncludeHost(t *testing.T) {
	err := &net.DNSError{Name: "private-host", Err: "private detail", IsNotFound: true}
	if diagnostic.NetworkClass(fmt.Errorf("outer: %w", err)) != "dns" {
		t.Fatal("missing DNS class")
	}
	if diagnostic.From(errors.New("unclassified private error")) != nil {
		t.Fatal("invented diagnostic")
	}
}
