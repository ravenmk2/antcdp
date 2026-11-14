package mysql

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/remotehosts"

	"golang.org/x/crypto/ssh"
)

func verifyRemoteHosts(t *testing.T, db *Store, installer *install.Service, admin, member, other *apiClient) {
	t.Helper()
	tag := func(c *apiClient, path string) map[string]string {
		c.call(t, "GET", path, nil, 200, nil)
		return map[string]string{"If-Match": c.last.Header().Get("ETag")}
	}
	base := "/admin/remote-hosts"
	member.call(t, "POST", base, map[string]any{"name": "unauthorized", "config": map[string]any{"host": "ssh.example.com"}}, 403, nil)
	v := testData(admin.call(t, "POST", base, map[string]any{"name": "SSH 主机验收", "code": "ssh-host-test", "config": map[string]any{"host": "ssh.example.com"}}, 201, nil))
	id := v["id"].(string)
	path := base + "/" + id
	if v["config"].(map[string]any)["port"] != float64(22) {
		t.Fatal("default SSH port missing")
	}
	member.call(t, "GET", path, nil, 403, nil)
	admin.call(t, "GET", "/admin/service-connections/ssh/"+id, nil, 404, nil)
	if strings.Contains(fmt.Sprint(member.call(t, "GET", "/service-connections", nil, 200, nil)), "ssh-host-test") {
		t.Fatal("SSH host leaked into service directory")
	}
	directory := fmt.Sprint(member.call(t, "GET", "/remote-hosts", nil, 200, nil))
	if !strings.Contains(directory, "ssh-host-test") || strings.Contains(directory, "ssh.example.com") {
		t.Fatal("invalid finite host directory")
	}
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	key := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
	old := tag(admin, path)
	admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"host_keys": []string{key}}}, 200, old)
	admin.call(t, "PATCH", path, map[string]any{"name": "stale"}, 412, old)
	stored := testData(admin.call(t, "GET", path, nil, 200, nil))
	if stored["host_key_fingerprints"].(map[string]any)[key] != ssh.FingerprintSHA256(signer.PublicKey()) {
		t.Fatal("host key fingerprint missing")
	}
	admin.call(t, "PATCH", path, map[string]any{"config": map[string]any{"host": "other.example.com"}}, 200, tag(admin, path))
	stored = testData(admin.call(t, "GET", path, nil, 200, nil))
	if value, ok := stored["config"].(map[string]any)["host_keys"]; ok && len(value.([]any)) > 0 {
		t.Fatal("trust survived address change")
	}
	personal := "/me/remote-hosts/" + id + "/credentials"
	auth := map[string]any{"auth_method": "ssh_password", "identity_config": map[string]any{"username": "deploy"}, "secret": map[string]any{"token": "ssh-test-password"}}
	cr := testData(member.call(t, "POST", personal, map[string]any{"name": "个人 SSH", "authentication": auth}, 201, tag(member, personal)))
	cid := cr["id"].(string)
	other.call(t, "GET", personal+"/"+cid, nil, 404, nil)
	admin.call(t, "GET", personal+"/"+cid, nil, 404, nil)
	admin.call(t, "DELETE", path, nil, 409, tag(admin, path))
	var ciphertext string
	if err := db.db.GetContext(context.Background(), &ciphertext, "SELECT secret_ciphertext FROM remote_host_credential WHERE id=?", cid); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ciphertext, "ssh-test-password") || strings.Contains(fmt.Sprint(cr), "ssh-test-password") {
		t.Fatal("SSH secret exposed")
	}

	store := func() (identity.Store, error) { return db, nil }
	svc := &remotehosts.Service{Identity: identity.New(store), Cipher: installer.RemoteHostSecret, ETag: installer.RemoteHostETag}
	hid, _ := strconv.ParseUint(id, 10, 64)
	credID, _ := strconv.ParseUint(cid, 10, 64)
	svc.Probe = func(_ context.Context, _ *remotehosts.Config, material string, started time.Time) remotehosts.Diagnostic {
		if !strings.Contains(material, "ssh-test-password") {
			t.Fatal("incorrect SSH plaintext")
		}
		return remotehosts.Diagnostic{ID: "ssh-material", Kind: "credential_verification", StartedAt: started, FinishedAt: time.Now(), Status: "succeeded", Summary: map[string]any{"authentication": "valid"}}
	}
	verify := func() {
		t.Helper()
		if _, _, err := svc.Verify(context.Background(), member.cookies["antcdp_session"].Value, hid, credID, remotehosts.CredentialOwnership{Type: "personal"}, tag(member, personal+"/"+cid)["If-Match"]); err != nil {
			t.Fatal(err)
		}
	}
	verify()
	newPurpose := fmt.Sprintf("remote-hosts/ssh/credential/%s/%s/ssh_password/v1", id, cid)
	plain, err := installer.RemoteHostSecret(newPurpose, ciphertext, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = installer.IntegrationSecret(newPurpose, ciphertext, false); err == nil {
		t.Fatal("independent key derivation missing")
	}
	legacyPurpose := fmt.Sprintf("service-integrations/ssh/credential/%s/%s/ssh_password/v1", id, cid)
	legacy, err := installer.IntegrationSecret(legacyPurpose, plain, true)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.db.ExecContext(context.Background(), "UPDATE remote_host_credential SET secret_ciphertext=?,secret_format_version=1 WHERE id=?", legacy, cid); err != nil {
		t.Fatal(err)
	}
	verify()
	// Replacing migrated authentication writes the independent v2 envelope.
	member.call(t, "PUT", personal+"/"+cid+"/authentication", auth, 200, tag(member, personal+"/"+cid))
	var format int
	if err = db.db.GetContext(context.Background(), &format, "SELECT secret_format_version FROM remote_host_credential WHERE id=?", cid); err != nil || format != 2 {
		t.Fatal("legacy rewrite failed", err)
	}
	verify()
	admin.call(t, "PATCH", path, map[string]any{"enabled": false}, 200, tag(admin, path))
	member.call(t, "POST", personal+"/"+cid+"/verify", map[string]any{}, 409, tag(member, personal+"/"+cid))
	deleteTag := tag(member, personal+"/"+cid)
	deleteTag["X-Collection-If-Match"] = tag(member, personal)["If-Match"]
	member.call(t, "DELETE", personal+"/"+cid, nil, 204, deleteTag)
	admin.call(t, "DELETE", path, nil, 204, tag(admin, path))
}
