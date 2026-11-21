package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeploymentConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.toml")
	data := `[database]
host="mysql"
port=3306
name="test"
username="user"
password="secret"
tls_mode="verify_identity"
ca_file="certs/mysql.pem"
[sandbox]
type="opensandbox"
endpoint="https://Cloud.Example:443/Api/"
api_key="key"
`
	if err := os.WriteFile(path, []byte(data), 0444); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ANTCDP_CONFIG_DIR", dir)
	r, err := Load(Overrides{DataDir: t.TempDir()})
	if err != nil || r.Sandbox.Endpoint != "https://cloud.example/Api" || r.Database.CAFile != filepath.Join(dir, "certs", "mysql.pem") {
		t.Fatal("deployment configuration", err)
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{data + "wrong_key=1", strings.Replace(data, "opensandbox", "unsupported", 1), ""} {
		if err := os.WriteFile(path, []byte(bad), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(Overrides{}); err == nil {
			t.Fatal("accepted invalid deployment configuration")
		}
	}
}
func TestRejectUnsafePublicURL(t *testing.T) {
	for _, url := range []string{"http://user:pass@example.com", "https://example.com/subpath", "https://example.com?secret=x", "//example.com", "ftp://example.com", "https://example.com/#fragment"} {
		if ValidateServer(Server{Listen: "127.0.0.1:0", PublicURL: url}) == nil {
			t.Errorf("accepted %q", url)
		}
	}
}
