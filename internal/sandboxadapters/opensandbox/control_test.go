package opensandbox

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	sdk "github.com/alibaba/OpenSandbox/sdks/sandbox/go"
	"github.com/ravenmk2/antcdp/internal/sandboxcore"
)

func testControlToken(t *testing.T) string {
	t.Helper()
	p := Provider{connection: sandboxcore.Connection{ControlKey: []byte(strings.Repeat("k", 32))}}
	token, err := p.controlToken(testOwner())
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestControlTokenStableAndSandboxScoped(t *testing.T) {
	p := Provider{connection: sandboxcore.Connection{ControlKey: []byte(strings.Repeat("k", 32)), APIKey: "first"}}
	first, err := p.controlToken(testOwner())
	if err != nil || len(first) != 64 {
		t.Fatal("invalid derived token", err)
	}
	p.connection.APIKey = "rotated"
	again, err := p.controlToken(testOwner())
	if err != nil || first != again {
		t.Fatal("provider key rotation changed daemon credential")
	}
	other := testOwner()
	other.CreationToken = strings.Repeat("c", 32)
	changed, err := p.controlToken(other)
	if err != nil || first == changed {
		t.Fatal("creation identity not bound")
	}
	other = testOwner()
	other.ComputerID++
	changed, err = p.controlToken(other)
	if err != nil || first == changed {
		t.Fatal("workspace identity not bound")
	}
	encoded, err := json.Marshal(p.connection)
	if err != nil || strings.Contains(string(encoded), "rotated") || strings.Contains(string(encoded), "ControlKey") {
		t.Fatal("private connection serialized credentials")
	}
}

func TestMissingControlKeyBlocksMutationBeforeNetwork(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("unsafe network call without control key") }))
	defer server.Close()
	p, err := (Factory{}).Open(context.Background(), sandboxcore.Connection{Endpoint: server.URL, APIKey: "control"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.Create(context.Background(), testSpec(t)); err == nil {
		t.Fatal("unsafe create accepted")
	}
	if err = p.Health(context.Background(), ptrRef(testRef())); err == nil {
		t.Fatal("unsafe data access accepted")
	}
}

func ptrRef(r sandboxcore.ResourceRef) *sandboxcore.ResourceRef { return &r }

func TestEndpointCannotReplaceDerivedControlIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/endpoints/") {
			jsonReply(t, w, sdk.Endpoint{Endpoint: "http://unused.test:44772", Headers: map[string]string{"X-EXECD-ACCESS-TOKEN": "different-identity"}})
			return
		}
		jsonReply(t, w, testInfo())
	}))
	defer server.Close()
	err := providerFor(t, server, "direct").Health(context.Background(), ptrRef(testRef()))
	if err == nil || err.Error() != "SANDBOX_CONTROL_IDENTITY_MISMATCH" {
		t.Fatal("remote endpoint changed authentication identity", err)
	}
}
