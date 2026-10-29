package integrations

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strconv"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func TestWebhookVerification(t *testing.T) {
	key := []byte("01234567890123456789012345678901")
	secret := "whsec_" + base64.StdEncoding.EncodeToString(key)
	now := time.Unix(1800000000, 0)
	body := []byte(`{"object_kind": "push"}`)
	ts := strconv.FormatInt(now.Unix(), 10)
	h := http.Header{}
	h.Set("webhook-id", "delivery-1")
	h.Set("webhook-timestamp", ts)
	mac := hmac.New(sha256.New, key)
	mac.Write([]byte("delivery-1." + ts + "."))
	mac.Write(body)
	h.Set("webhook-signature", "v1,invalid v1,"+base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	if !VerifyWebhook("signing_token", secret, h, body, now) {
		t.Fatal("valid signature rejected")
	}
	if VerifyWebhook("signing_token", secret, h, []byte(`{"object_kind":"push"}`), now) {
		t.Fatal("raw body not bound")
	}
	if VerifyWebhook("signing_token", secret, h, body, now.Add(301*time.Second)) {
		t.Fatal("expired signature accepted")
	}
	if VerifyWebhook("signing_token", secret, h, body, now.Add(-301*time.Second)) {
		t.Fatal("future signature accepted")
	}
	h.Set("X-Gitlab-Token", secret)
	h.Del("webhook-signature")
	if VerifyWebhook("signing_token", secret, h, body, now) {
		t.Fatal("signature downgraded")
	}
	if !VerifyWebhook("secret_token", secret, h, body, now) {
		t.Fatal("ordinary token rejected")
	}
	h.Add("X-Gitlab-Token", secret)
	if VerifyWebhook("secret_token", secret, h, body, now) {
		t.Fatal("ambiguous header accepted")
	}
}
func TestNetworkValidation(t *testing.T) {
	for _, raw := range []string{"ftp://gitlab.example.com", "http://127.0.0.1", "http://169.254.169.254", "https://user:password@example.com", "https://example.com/?token=x", "https://example.com/#fragment", "https://127.0.0.1", "https://[::1]", "https://169.254.169.254", "https://0.0.0.0", "https://example.com/%2e%2e/admin"} {
		if ValidateConfig(raw, nil) == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	for _, raw := range []string{"http://gitlab.example.com", "http://10.0.0.20:8080/gitlab", "https://gitlab.example.com/gitlab", "https://10.0.0.20", "https://[fd00::1]"} {
		if e := ValidateConfig(raw, nil); e != nil {
			t.Errorf("rejected business endpoint %s", raw)
		}
	}
	for _, raw := range []string{"::ffff:127.0.0.1", "100.100.100.200", "169.254.170.2", "fe80::1", "224.0.0.1", "64:ff9b::7f00:1"} {
		if allowedIP(netip.MustParseAddr(raw)) {
			t.Errorf("unsafe actual address %s", raw)
		}
	}
	ca := "-----BEGIN PRIVATE KEY-----"
	if ValidateConfig("https://example.com", &ca) == nil {
		t.Fatal("private key accepted as CA")
	}
}
func TestSecretBindingAndCollectionABA(t *testing.T) {
	key := cryptox.Random(32)
	secret, e := cryptox.Encrypt(key, "installation", purpose("credential", 10, 1, "gitlab_access_token"), "secret-token")
	if e != nil {
		t.Fatal(e)
	}
	for _, binding := range []string{purpose("credential", 10, 2, "gitlab_access_token"), purpose("credential", 11, 1, "gitlab_access_token"), purpose("webhook", 10, 1, "secret_token")} {
		if _, e = cryptox.Decrypt(key, "installation", binding, secret); e == nil {
			t.Fatal("swapped secret decrypted")
		}
	}
	v := ServiceConnection{ID: 1, CredentialsVersion: 1}
	s := CredentialOwnership{Type: "personal", Owner: 2}
	svc := &Service{ETag: func(v string) string {
		h := hmac.New(sha256.New, key)
		h.Write([]byte(v))
		return fmt.Sprintf("%x", h.Sum(nil))
	}}
	old := svc.collectionTag(&v, s)
	if old == svc.collectionTag(&v, CredentialOwnership{Type: "personal", Owner: 3}) {
		t.Fatal("scope unbound")
	}
	v.CredentialsVersion += 2
	if old == svc.collectionTag(&v, s) {
		t.Fatal("ABA accepted")
	}
}

func TestDialRejectsActualLocalAddresses(t *testing.T) {
	tr := transport(&HTTPConfig{})
	defer tr.CloseIdleConnections()
	for _, address := range []string{"127.0.0.1:443", "[::1]:443", "169.254.169.254:80", "100.100.100.200:80"} {
		conn, err := tr.DialContext(context.Background(), "tcp", address)
		if err == nil {
			_ = conn.Close()
			t.Fatalf("connected to forbidden address %s", address)
		}
	}
}

// Exercise the real probe and guarded transport over an allowed interface,
// including subpath construction, without contacting an external service.
func TestHTTPConnectionProbe(t *testing.T) {
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	var listener net.Listener
	for _, address := range addresses {
		prefix, err := netip.ParsePrefix(address.String())
		if err != nil || !prefix.Addr().Is4() || !allowedIP(prefix.Addr()) {
			continue
		}
		listener, err = net.Listen("tcp", net.JoinHostPort(prefix.Addr().String(), "0"))
		if err == nil {
			break
		}
	}
	if listener == nil {
		t.Skip("no allowed local network interface")
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/gitlab/-/health" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
	}))
	if err := server.Listener.Close(); err != nil {
		t.Fatal(err)
	}
	server.Listener = listener
	server.Start()
	defer server.Close()
	config := &HTTPConfig{BaseURL: server.URL + "/gitlab"}
	if err := ValidateConfig(config.BaseURL, nil); err != nil {
		t.Fatal(err)
	}
	result := probe(context.Background(), config, "", time.Now())
	if result.Status != "succeeded" {
		t.Fatalf("HTTP probe failed: %+v", result)
	}
}
