package remotehosts

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/pem"
	"errors"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func sshTestKey(t *testing.T) (ssh.Signer, string, string) {
	t.Helper()
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(private)
	if err != nil {
		t.Fatal(err)
	}
	plain, err := ssh.MarshalPrivateKey(private, "test")
	if err != nil {
		t.Fatal(err)
	}
	encrypted, err := ssh.MarshalPrivateKeyWithPassphrase(private, "test", []byte("test-passphrase"))
	if err != nil {
		t.Fatal(err)
	}
	return signer, string(pem.EncodeToMemory(plain)), string(pem.EncodeToMemory(encrypted))
}

func TestSSHAuthenticationAndTrust(t *testing.T) {
	signer, plain, encrypted := sshTestKey(t)
	wrong, _, _ := sshTestKey(t)
	for _, test := range []struct {
		name, method, key, pass, password, trust, want string
		noAuth                                         bool
	}{
		{"password", "ssh_password", "", "", "correct", "trusted", "succeeded", false},
		{"private key", "ssh_private_key", plain, "", "", "trusted", "succeeded", false},
		{"encrypted key", "ssh_encrypted_key", encrypted, "test-passphrase", "", "trusted", "succeeded", false},
		{"wrong password", "ssh_password", "", "", "wrong", "trusted", "authentication_failed", false},
		{"untrusted", "ssh_password", "", "", "correct", "unknown", "host_key_untrusted", false},
		{"mismatch", "ssh_password", "", "", "correct", "mismatch", "host_key_mismatch", false},
		{"no authentication required", "ssh_password", "", "", "correct", "trusted", "authentication_not_required", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var attempted atomic.Int32
			ln, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = ln.Close() }()
			done := make(chan struct{})
			go func() {
				defer close(done)
				conn, e := ln.Accept()
				if e != nil {
					return
				}
				defer func() { _ = conn.Close() }()
				_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
				cfg := &ssh.ServerConfig{NoClientAuth: test.noAuth, PasswordCallback: func(_ ssh.ConnMetadata, p []byte) (*ssh.Permissions, error) {
					attempted.Add(1)
					if string(p) != "correct" {
						return nil, errors.New("invalid")
					}
					return nil, nil
				}, PublicKeyCallback: func(_ ssh.ConnMetadata, p ssh.PublicKey) (*ssh.Permissions, error) {
					attempted.Add(1)
					if string(p.Marshal()) != string(signer.PublicKey().Marshal()) {
						return nil, errors.New("invalid")
					}
					return nil, nil
				}}
				cfg.AddHostKey(signer)
				server, ch, req, e := ssh.NewServerConn(conn, cfg)
				if e != nil {
					return
				}
				defer func() { _ = server.Close() }()
				go ssh.DiscardRequests(req)
				for c := range ch {
					_ = c.Reject(ssh.Prohibited, "no channels allowed")
				}
			}()
			cfg := &Config{Host: "ssh.example.com", Port: 22}
			switch test.trust {
			case "trusted":
				cfg.HostKeys = []string{string(ssh.MarshalAuthorizedKey(signer.PublicKey()))}
			case "mismatch":
				cfg.HostKeys = []string{string(ssh.MarshalAuthorizedKey(wrong.PublicKey()))}
			}
			a := &Authentication{Method: test.method, Identity: []byte(`{"username":"deploy"}`), Secret: &TokenSecret{Token: test.password, PrivateKey: test.key, Passphrase: test.pass}}
			if err := validateAuthenticationFor("ssh", a); err != nil {
				t.Fatal(err)
			}
			d := runSSHProbe(context.Background(), cfg, "deploy", secretMaterial("ssh", a), time.Now(), func(ctx context.Context, _, _ string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "tcp", ln.Addr().String())
			})
			if test.want == "succeeded" {
				if d.Status != "succeeded" {
					t.Fatalf("%+v", d)
				}
			} else if d.Summary["reason"] != test.want {
				t.Fatalf("%+v", d)
			}
			if test.trust != "trusted" && attempted.Load() != 0 {
				t.Fatal("sent credentials before host trust")
			}
			<-done
		})
	}
}

func TestSSHConfigAndKeyValidation(t *testing.T) {
	_, plain, encrypted := sshTestKey(t)
	for _, a := range []*Authentication{
		{Method: "ssh_private_key", Secret: &TokenSecret{PrivateKey: encrypted}},
		{Method: "ssh_encrypted_key", Secret: &TokenSecret{PrivateKey: encrypted, Passphrase: "wrong"}},
		{Method: "ssh_password", Secret: &TokenSecret{Token: "x", PrivateKey: plain}},
		{Method: "ssh_agent", Secret: &TokenSecret{PrivateKey: plain}},
	} {
		a.Identity = []byte(`{"username":"user"}`)
		if validateAuthenticationFor("ssh", a) == nil {
			t.Fatal("accepted invalid authentication")
		}
	}
	for _, host := range []string{"127.0.0.1", "::1", "169.254.169.254", "host:22", "ssh://example.com", "host/path"} {
		if validateSSHConfig(&Config{Host: host, Port: 22}) == nil {
			t.Fatal("accepted", host)
		}
	}
	if _, err := decodeSSHConfig(1, []byte(`{"host":"example.com","port":22,"unknown":true}`)); err == nil {
		t.Fatal("accepted unknown config")
	}
	if validateSSHConfig(&Config{Host: "example.com", HostKeys: []string{plain}}) == nil {
		t.Fatal("accepted private host key")
	}
	cfg := &Config{Host: "example.com"}
	if validateSSHConfig(cfg) != nil || cfg.Port != 22 {
		t.Fatal("wrong default")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	d := probeSSH(ctx, cfg, "", "", time.Now())
	if d.Status == "succeeded" {
		t.Fatal("cancelled call succeeded")
	}
	if strings.Contains(secretMaterial("ssh", &Authentication{Method: "ssh_private_key", Secret: &TokenSecret{PrivateKey: plain}}), "ssh_password") {
		t.Fatal("wrong material method")
	}
}
