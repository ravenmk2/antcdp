package integrations

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func TestJenkinsAuthentication(t *testing.T) {
	for _, raw := range []string{`{}`, `null`, `{"username":null}`, `{"username":42}`, `{"username":""}`, `{"username":" bot"}`, `{"username":"bot:"}`, `{"username":"bot\n"}`, `{"username":"bot","password":"hidden"}`} {
		if jenkinsIdentity(json.RawMessage(raw)) == nil {
			t.Fatalf("accepted identity %s", raw)
		}
	}
	valid := &Authentication{Method: "jenkins_api_token", Identity: json.RawMessage(`{"username":"构建用户"}`), Secret: &TokenSecret{Token: "jenkins-test-token"}}
	if err := validateAuthenticationFor("jenkins", valid); err != nil {
		t.Fatal(err)
	}
	if validateAuthenticationFor("gitlab", valid) == nil {
		t.Fatal("cross-type authentication accepted")
	}
	valid.Method = "gitlab_access_token"
	if validateAuthenticationFor("jenkins", valid) == nil {
		t.Fatal("wrong authentication method accepted")
	}
	key := make([]byte, 32)
	binding := credentialPurpose("jenkins", "credential", 1, 2, "jenkins_api_token")
	sealed, err := cryptox.Encrypt(key, "installation", binding, "token-secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = cryptox.Decrypt(key, "installation", credentialPurpose("gitlab", "credential", 1, 2, "jenkins_api_token"), sealed); err == nil {
		t.Fatal("ciphertext accepted by another service")
	}
	if purpose("credential", 1, 2, "gitlab_access_token") != "service-integrations/gitlab/credential/1/2/gitlab_access_token/v1" {
		t.Fatal("GitLab encryption binding changed")
	}
}

func TestJenkinsProbe(t *testing.T) {
	for _, tc := range []struct {
		name, token, body, contentType, status, reason string
		code                                           int
	}{
		{"anonymous connection", "", `{"name":"anonymous","authenticated":false,"anonymous":true}`, "application/json", "succeeded", "", 200},
		{"authenticated", "test-api-token", `{"name":"bot","authenticated":true,"anonymous":false,"authorities":["admin"],"details":"private"}`, "application/json;charset=UTF-8", "succeeded", "", 200},
		{"anonymous credential", "test-api-token", `{"name":"anonymous","authenticated":true,"anonymous":true}`, "application/json", "failed", "authentication_failed", 200},
		{"proxy identity", "test-api-token", `{"name":"other","authenticated":true,"anonymous":false}`, "application/json", "failed", "identity_mismatch", 200},
		{"missing flags", "test-api-token", `{"name":"bot"}`, "application/json", "failed", "invalid_response", 200},
		{"login page", "test-api-token", "<html>login</html>", "text/html", "failed", "invalid_response", 200},
		{"malformed JSON", "", "{}{}", "application/json", "failed", "invalid_response", 200},
		{"oversized", "", strings.Repeat(" ", (1<<20)+1), "application/json", "failed", "invalid_response", 200},
		{"invalid token", "test-api-token", "", "application/json", "failed", "authentication_failed", 401},
		{"forbidden", "test-api-token", "", "application/json", "failed", "access_denied", 403},
		{"redirect", "test-api-token", "", "application/json", "failed", "redirected", 302},
		{"proxy failure", "", "", "text/html", "failed", "unexpected_status", 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				if r.Method != "GET" || r.URL.Path != "/jenkins/whoAmI/api/json" || r.URL.RawQuery != "" {
					t.Errorf("unexpected request %s %s", r.Method, r.URL)
				}
				if tc.token == "" {
					if r.Header.Get("Authorization") != "" {
						t.Error("connection check used credentials")
					}
				} else if user, token, ok := r.BasicAuth(); !ok || user != "bot" || token != tc.token {
					t.Error("missing preemptive Basic authentication")
				}
				w.Header().Set("Content-Type", tc.contentType)
				w.Header().Set("Location", "/login")
				w.WriteHeader(tc.code)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()
			client := srv.Client()
			client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			d := checkJenkins(context.Background(), client, srv.URL+"/jenkins/", "bot", tc.token, time.Now())
			if d.Status != tc.status || tc.reason != "" && d.Summary["reason"] != tc.reason || requests != 1 {
				t.Fatalf("unexpected result %+v requests %d", d, requests)
			}
			if tc.token != "" && d.Summary["permissions"] != "unknown" {
				t.Fatal("invented business permission")
			}
			if tc.code == 403 && d.Summary["authentication"] != "unknown" {
				t.Fatal("403 misclassified as bad token")
			}
			encoded, _ := json.Marshal(d)
			if strings.Contains(string(encoded), "test-api-token") || strings.Contains(string(encoded), "private") || strings.Contains(string(encoded), "authorities") {
				t.Fatal("diagnostic leaked response/secret")
			}
		})
	}
}

func TestJenkinsTLSAndCancellation(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer srv.Close()
	d := checkJenkins(context.Background(), &http.Client{Timeout: time.Second}, srv.URL, "", "", time.Now())
	if d.Summary["reason"] != "tls_failed" {
		t.Fatalf("TLS not enforced: %+v", d)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	d = checkJenkins(ctx, srv.Client(), srv.URL, "", "", time.Now())
	if d.Status != "failed" || d.Summary["reachability"] != "unreachable" {
		t.Fatalf("cancellation ignored: %+v", d)
	}
}
