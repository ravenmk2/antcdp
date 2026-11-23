package integrations

import (
	"errors"
	"net/url"
	"testing"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

// Unimplemented repository methods panic on use, including secret reads.
type gitCredentialGateFixture struct {
	Repository
	connection ServiceConnection
	granted    bool
}

func (r gitCredentialGateFixture) Connection(uint64) (*ServiceConnection, error) {
	return &r.connection, nil
}
func (r gitCredentialGateFixture) ConnectionUserScopes(uint64) ([]CredentialOwnership, error) {
	return []CredentialOwnership{{Type: "project", Owner: 1}}, nil
}
func (r gitCredentialGateFixture) ConnectionGranted(uint64, CredentialOwnership, bool) (bool, error) {
	return r.granted, nil
}

func TestPersonalGitCredentialChecksBeforeReadingMaterial(t *testing.T) {
	for _, test := range []struct {
		kind             string
		granted, enabled bool
		code             string
	}{
		{"mysql", true, true, "SERVICE_TYPE_UNSUPPORTED"},
		{"mysql", false, true, "NOT_FOUND"},
		{"gitlab", false, true, "NOT_FOUND"},
		{"gitlab", true, false, "RESOURCE_DISABLED"},
	} {
		r := gitCredentialGateFixture{connection: ServiceConnection{ID: 1, Type: test.kind, Ownership: "platform", Enabled: test.enabled}, granted: test.granted}
		_, err := (&Service{}).ownedRepoSnapshot(r, 1, true, CredentialOwnership{Type: "user", Owner: 2})
		var failure *httpx.Error
		if !errors.As(err, &failure) || failure.Code != test.code {
			t.Errorf("%+v: got %v", test, err)
		}
	}
}

func TestGitOriginUsesConfiguredHTTPSAuthority(t *testing.T) {
	base, _ := url.Parse("https://git.example.test/install")
	for _, raw := range []string{"http://git.example.test/install/team/repo.git", "https://git.example.test/install/team/repo.git"} {
		origin, err := gitOrigin(base, &raw)
		if err != nil || origin.String() != "https://git.example.test/install/team/repo.git" {
			t.Fatalf("unexpected remote for %q: %v, %v", raw, origin, err)
		}
	}
	for _, raw := range []string{"http://git.example.test:81/install/team/repo.git", "https://other.test/install/team/repo.git", "https://git.example.test/installation/repo.git", "https://git.example.test/install/../another.git", "https://user:password@git.example.test/install/repo.git", "file:///install/repo.git"} {
		if _, err := gitOrigin(base, &raw); err == nil {
			t.Errorf("accepted %q", raw)
		}
	}
}
