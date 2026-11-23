package mysql

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
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

func verifyRemoteHosts(t *testing.T, db *Store, installer *install.Service, admin, member, other *apiClient, memberID string) {
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
	catalog := "/me/credentials"
	cr := testData(member.call(t, "POST", catalog, map[string]any{"name": "个人 SSH", "kind": "username_password", "identifier": "deploy", "material": map[string]string{"value": "ssh-test-password"}}, 201, nil))
	cid := cr["id"].(string)
	cp := catalog + "/" + cid
	other.call(t, "GET", cp, nil, 404, nil)
	admin.call(t, "GET", cp, nil, 404, nil)
	member.call(t, "PUT", personal+"/preferred", map[string]string{"credential_id": cid}, 200, tag(member, personal+"/preferred"))
	member.call(t, "DELETE", cp, nil, 409, tag(member, cp))
	var ciphertext string
	if err := db.db.GetContext(context.Background(), &ciphertext, "SELECT ciphertext FROM credential WHERE id=?", cid); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(ciphertext, "ssh-test-password") || strings.Contains(fmt.Sprint(cr), "ssh-test-password") {
		t.Fatal("SSH secret exposed")
	}

	store := func() (identity.Store, error) { return db, nil }
	svc := &remotehosts.Service{Identity: identity.New(store), Cipher: installer.CredentialSecret, ETag: installer.RemoteHostETag}
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
		if _, _, err := svc.Verify(context.Background(), member.cookies["antcdp_session"].Value, hid, credID, remotehosts.CredentialOwnership{Type: "user"}, tag(member, cp)["If-Match"]); err != nil {
			t.Fatal(err)
		}
	}
	verify()
	purpose := "credential/" + cid + "/username_password/v1"
	if _, err := installer.CredentialSecret(purpose, ciphertext, false); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.IntegrationSecret(purpose, ciphertext, false); err == nil {
		t.Fatal("independent key derivation missing")
	}
	// Two hosts use the same project key. Both must resolve the replacement material.
	project := testData(admin.call(t, "POST", "/projects", map[string]any{"name": "SSH 轮换", "code": "ssh-rotation", "admin_user_ids": []string{memberID}}, 201, nil))["id"].(string)
	projectBase := "/projects/" + project
	second := testData(admin.call(t, "POST", base, map[string]any{"name": "第二台 SSH 主机", "config": map[string]string{"host": "second.example.com"}}, 201, nil))["id"].(string)
	makeKey := func(pass string) string {
		_, k, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			t.Fatal(e)
		}
		block, e := ssh.MarshalPrivateKeyWithPassphrase(k, "fixture", []byte(pass))
		if e != nil {
			t.Fatal(e)
		}
		return string(pem.EncodeToMemory(block))
	}
	currentKey := makeKey("first")
	keyBody := func(value, pass string) map[string]string {
		return map[string]string{"value": value, "passphrase": pass}
	}
	entry := testData(admin.call(t, "POST", projectBase+"/credentials", map[string]any{"name": "项目发布", "code": "deploy", "kind": "ssh_private_key", "identifier": "deploy", "material": keyBody(currentKey, "first")}, 201, nil))
	keyID := entry["id"].(string)
	catalogKey := projectBase + "/credentials/" + keyID
	// An AccessKey pair can be managed independently but cannot be used for SSH.
	ak := testData(admin.call(t, "POST", projectBase+"/credentials", map[string]any{"name": "云服务", "kind": "access_key_pair", "identifier": "test-id", "material": map[string]string{"value": "test-secret"}}, 201, nil))
	for _, host := range []string{id, second} {
		pref := projectBase + "/remote-hosts/" + host + "/credentials/preferred"
		admin.call(t, "PUT", pref, map[string]any{"credential_id": ak["id"]}, 404, tag(admin, pref))
		admin.call(t, "PUT", pref, map[string]string{"credential_id": keyID}, 200, tag(admin, pref))
	}
	svc.Probe = func(_ context.Context, _ *remotehosts.Config, material string, started time.Time) remotehosts.Diagnostic {
		var decoded struct {
			Secret remotehosts.TokenSecret `json:"secret"`
		}
		if json.Unmarshal([]byte(material), &decoded) != nil || decoded.Secret.PrivateKey != currentKey {
			t.Fatal("wrong project key after rotation")
		}
		return remotehosts.Diagnostic{ID: "project-key", Kind: "credential_verification", StartedAt: started, Status: "succeeded", FinishedAt: time.Now()}
	}
	pid, _ := strconv.ParseUint(project, 10, 64)
	kid, _ := strconv.ParseUint(keyID, 10, 64)
	verifyBoth := func() {
		for _, host := range []string{id, second} {
			hid, _ := strconv.ParseUint(host, 10, 64)
			if _, _, err := svc.Verify(t.Context(), admin.cookies["antcdp_session"].Value, hid, kid, remotehosts.CredentialOwnership{Type: "project", Owner: pid}, tag(admin, catalogKey)["If-Match"]); err != nil {
				t.Fatal(err)
			}
		}
	}
	verifyBoth()
	currentKey = makeKey("second")
	admin.call(t, "PATCH", catalogKey, map[string]any{"material": keyBody(currentKey, "second")}, 200, tag(admin, catalogKey))
	verifyBoth()
	admin.call(t, "DELETE", catalogKey, nil, 409, tag(admin, catalogKey))
	admin.call(t, "GET", "/teams/"+project+"/credentials", nil, 404, nil)
	admin.call(t, "PATCH", path, map[string]any{"enabled": false}, 200, tag(admin, path))
	member.call(t, "POST", personal+"/"+cid+"/verify", map[string]any{}, 409, tag(member, cp))
	admin.call(t, "DELETE", path, nil, 204, tag(admin, path))
	member.call(t, "DELETE", cp, nil, 204, tag(member, cp))
}
