package mysql

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
	"golang.org/x/crypto/ssh"
)

func verifyRemoteHostMigration(t *testing.T, ctx context.Context, s *Store, p *goose.Provider) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	public := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
	cfg, _ := json.Marshal(map[string]any{"host": "migration.example.com", "port": 2222, "host_keys": []string{public}})
	master := cryptox.Random(32)
	purpose := "service-integrations/ssh/credential/101/201/ssh_password/v1"
	sealed, err := cryptox.Encrypt(master, "migration-fixture", purpose, "migration-secret")
	if err != nil {
		t.Fatal(err)
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := s.db.ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO service_connection(id,service_type,code,name,config,config_schema_version,fallback_credential_id,row_version,config_version,credentials_version,fallback_version,created_by_user_id,created_at,updated_at) VALUES(101,'ssh','migration-host','Migration host',?,1,201,4,3,5,2,41,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", cfg)
	for j, scope := range []string{"system", "project", "personal"} {
		var project, user any
		if scope == "project" {
			project = 801
		}
		if scope == "personal" {
			user = 42
		}
		exec(`INSERT INTO service_credential(id,connection_id,service_type,code,ownership_type,project_id,user_id,name,auth_method,identity_config,secret_ciphertext,secret_format_version,secret_key_version,is_preferred,row_version,material_version,created_by_user_id,created_at,updated_at) VALUES(?,101,'ssh',?,?,?,?,'Migration credential','ssh_password','{"username":"deploy"}',?,1,'v1',TRUE,6,2,41,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, 201+j, fmt.Sprint("migration-", j), scope, project, user, sealed)
	}
	if _, err = p.UpTo(ctx, 7); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM service_connection WHERE service_type='ssh'"); err != nil || count != 0 {
		t.Fatal("legacy hosts retained", err)
	}
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM service_credential WHERE service_type='ssh'"); err != nil || count != 0 {
		t.Fatal("legacy credentials retained", err)
	}
	if err = s.db.GetContext(ctx, &count, "SELECT COUNT(*) FROM remote_host_credential WHERE host_id=101 AND is_preferred=TRUE AND row_version=6 AND material_version=2"); err != nil || count != 3 {
		t.Fatal("ownership/preferences lost", err)
	}
	var fingerprint string
	if err = s.db.GetContext(ctx, &fingerprint, "SELECT fingerprint_sha256 FROM remote_host_key WHERE host_id=101"); err != nil || fingerprint != ssh.FingerprintSHA256(signer.PublicKey()) {
		t.Fatal("fingerprint changed", err)
	}
	err = s.Transact(ctx, func(tx identity.Tx) error {
		r := tx.(*identityTx).RemoteHosts()
		h, e := r.Connection(101)
		if e != nil {
			return e
		}
		if h.Config.Host != "migration.example.com" || h.Config.Port != 2222 || h.FallbackID == nil || *h.FallbackID != 201 || h.Version != 4 || h.ConfigVersion != 3 || h.CredentialsVersion != 5 || h.FallbackVersion != 2 {
			t.Fatal("host metadata lost")
		}
		cr, e := r.Credential(201)
		if e != nil {
			return e
		}
		if cr.SecretFormat != 1 || cr.Username != "deploy" {
			t.Fatal("legacy material changed")
		}
		cipher, e := r.Secret("credential", 201)
		if e != nil {
			return e
		}
		plain, e := cryptox.Decrypt(master, "migration-fixture", purpose, cipher)
		if e != nil {
			return e
		}
		if plain != "migration-secret" {
			t.Fatal("secret changed")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	exec("DELETE FROM remote_host_credential WHERE host_id=101")
	exec("DELETE FROM remote_host_key WHERE host_id=101")
	exec("DELETE FROM remote_host WHERE id=101")
}
