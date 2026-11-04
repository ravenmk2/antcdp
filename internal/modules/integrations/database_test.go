package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgproto3"
)

func TestDatabaseContracts(t *testing.T) {
	for _, kind := range []string{"mysql", "postgresql"} {
		t.Run(kind, func(t *testing.T) {
			for _, suffix := range []string{"db.example.com/app", "10.20.0.2:15432/app", "[fd12::1]/app", "db.example.com/a%20b"} {
				cfg := HTTPConfig{BaseURL: kind + "://" + suffix, TLSMode: "verify-full"}
				raw, _ := json.Marshal(cfg)
				if _, err := DecodeConnectionConfig(kind, 1, raw); err != nil {
					t.Fatalf("valid config rejected %s: %v", suffix, err)
				}
			}
			for _, suffix := range []string{"localhost", "127.0.0.1/app", "[::1]/app", "169.254.169.254/app", "db.example.com/", "db.example.com/a/b", "db.example.com:0/app", "db.example.com:65536/app", "db.example.com:/app", "user:password@db.example.com/app", "db.example.com/app?sslmode=disable", "db.example.com/app#x", "db.example.com/app%00", "one,two/app"} {
				if validateTypedConfig(kind, &HTTPConfig{BaseURL: kind + "://" + suffix, TLSMode: "verify-full"}) == nil {
					t.Errorf("accepted %s", suffix)
				}
			}
			for _, mode := range []string{"", "prefer", "require", "skip-verify"} {
				if validateTypedConfig(kind, &HTTPConfig{BaseURL: kind + "://db.example.com/app", TLSMode: mode}) == nil {
					t.Errorf("accepted TLS mode %q", mode)
				}
			}
			auth := &Authentication{Method: kind + "_password", Identity: json.RawMessage(`{"username":"bot"}`), Secret: &TokenSecret{Token: " a "}}
			if err := validateAuthenticationFor(kind, auth); err != nil {
				t.Fatal("short password rejected", err)
			}
			auth.Secret.Token = ""
			if validateAuthenticationFor(kind, auth) == nil {
				t.Fatal("empty password accepted")
			}
			raw := json.RawMessage(fmt.Sprintf(`{"base_url":"%s://db.example.com/app","tls_mode":"disable","default_organization":""}`, kind))
			if _, err := DecodeConnectionConfig(kind, 1, raw); err == nil {
				t.Fatal("foreign field accepted")
			}
			d := probeDatabase(context.Background(), &HTTPConfig{BaseURL: kind + "://127.0.0.1/app", TLSMode: "disable"}, kind, "bot", "private-password", time.Now())
			if d.Status != "failed" || d.Summary["reachability"] != "unreachable" {
				t.Fatal("local connection allowed", d)
			}
		})
	}
	if _, err := DecodeConnectionConfig("gitlab", 1, json.RawMessage(`{"base_url":"https://example.com","tls_mode":""}`)); err == nil {
		t.Fatal("HTTP accepted database field")
	}
}

func TestDatabaseTLSAndReasons(t *testing.T) {
	cfg := &HTTPConfig{TLSMode: "verify-full"}
	tls := databaseTLS(cfg, "db.example.com")
	if tls == nil || tls.InsecureSkipVerify || tls.ServerName != "db.example.com" || tls.RootCAs == nil {
		t.Fatal("unsafe TLS configuration")
	}
	cfg.TLSMode = "disable"
	if databaseTLS(cfg, "db.example.com") != nil {
		t.Fatal("TLS disable ignored")
	}
	for _, tc := range []struct {
		err    error
		reason string
	}{
		{&mysql.MySQLError{Number: 1045, Message: "private-secret"}, "authentication_failed"},
		{&mysql.MySQLError{Number: 1044}, "access_denied"}, {&mysql.MySQLError{Number: 1049}, "database_not_found"},
		{&pgconn.PgError{Code: "28P01", Message: "private-secret"}, "authentication_failed"},
		{&pgconn.PgError{Code: "42501"}, "access_denied"}, {&pgconn.PgError{Code: "3D000"}, "database_not_found"},
		{errors.New("private-secret"), "connection_failed"},
	} {
		if got := databaseReason(fmt.Errorf("wrapped: %w", tc.err)); got != tc.reason {
			t.Errorf("got %s want %s", got, tc.reason)
		}
	}
}

func TestPostgreSQLNativeVerification(t *testing.T) {
	for _, denied := range []bool{false, true} {
		t.Run(fmt.Sprint(denied), func(t *testing.T) {
			client, server := net.Pipe()
			defer func() { _ = client.Close(); _ = server.Close() }()
			done := make(chan error, 1)
			go func() {
				_ = server.SetDeadline(time.Now().Add(3 * time.Second))
				b := pgproto3.NewBackend(server, server)
				msg, err := b.ReceiveStartupMessage()
				if err != nil {
					done <- err
					return
				}
				startup, ok := msg.(*pgproto3.StartupMessage)
				if !ok || startup.Parameters["user"] != "bot" || startup.Parameters["database"] != "app" || startup.Parameters["options"] != "" {
					done <- errors.New("incorrect startup")
					return
				}
				b.Send(&pgproto3.AuthenticationCleartextPassword{})
				if err := b.Flush(); err != nil {
					done <- err
					return
				}
				msg, err = b.Receive()
				password, ok := msg.(*pgproto3.PasswordMessage)
				if err != nil || !ok || password.Password != "private-password" {
					done <- errors.New("incorrect password")
					return
				}
				if denied {
					b.Send(&pgproto3.ErrorResponse{Severity: "FATAL", Code: "28P01", Message: "private remote error"})
					done <- b.Flush()
					return
				}
				b.Send(&pgproto3.AuthenticationOk{})
				b.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
				if err := b.Flush(); err != nil {
					done <- err
					return
				}
				msg, err = b.Receive()
				query, ok := msg.(*pgproto3.Query)
				if err != nil || !ok || query.String != "SELECT 1" {
					done <- errors.New("unexpected SQL")
					return
				}
				b.Send(&pgproto3.RowDescription{Fields: []pgproto3.FieldDescription{{Name: []byte("?column?"), DataTypeOID: 23, DataTypeSize: 4}}})
				b.Send(&pgproto3.DataRow{Values: [][]byte{[]byte("1")}})
				b.Send(&pgproto3.CommandComplete{CommandTag: []byte("SELECT 1")})
				b.Send(&pgproto3.ReadyForQuery{TxStatus: 'I'})
				if err := b.Flush(); err != nil {
					done <- err
					return
				}
				_, err = b.Receive()
				done <- err
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			err := verifyPostgreSQL(ctx, &HTTPConfig{TLSMode: "disable"}, "db.example.com", "db.example.com:5432", "app", "bot", "private-password", func(context.Context, string, string) (net.Conn, error) { return client, nil })
			if denied {
				if databaseReason(err) != "authentication_failed" {
					t.Fatal(err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestDatabaseCancellation(t *testing.T) {
	for _, kind := range []string{"mysql", "postgresql"} {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		d := probeDatabase(ctx, &HTTPConfig{BaseURL: kind + "://db.example.com/app", TLSMode: "verify-full"}, kind, "bot", "private-password", time.Now())
		raw, _ := json.Marshal(d)
		if d.Status != "failed" || strings.Contains(string(raw), "private-password") {
			t.Fatal(d)
		}
	}
}

func TestMySQLNativeVerification(t *testing.T) {
	for _, denied := range []bool{false, true} {
		t.Run(fmt.Sprint(denied), func(t *testing.T) {
			client, server := net.Pipe()
			defer func() { _ = client.Close(); _ = server.Close() }()
			done := make(chan error, 1)
			go func() {
				_ = server.SetDeadline(time.Now().Add(3 * time.Second))
				packet := func(sequence byte, body []byte) error {
					_, err := server.Write(append([]byte{byte(len(body)), byte(len(body) >> 8), byte(len(body) >> 16), sequence}, body...))
					return err
				}
				receive := func() ([]byte, error) {
					var header [4]byte
					if _, err := io.ReadFull(server, header[:]); err != nil {
						return nil, err
					}
					n := int(header[0]) | int(header[1])<<8 | int(header[2])<<16
					if n > 8192 {
						return nil, errors.New("oversized client packet")
					}
					data := make([]byte, n)
					_, err := io.ReadFull(server, data)
					return data, err
				}
				greeting := []byte{10}
				greeting = append(greeting, []byte("8.0.0-test\x00")...)
				greeting = append(greeting, 1, 0, 0, 0)
				greeting = append(greeting, []byte("12345678")...)
				greeting = append(greeting, 0, 0x0d, 0xa2, 45, 2, 0, 8, 0, 21)
				greeting = append(greeting, make([]byte, 10)...)
				greeting = append(greeting, []byte("abcdefghijkl\x00mysql_native_password\x00")...)
				if err := packet(0, greeting); err != nil {
					done <- err
					return
				}
				auth, err := receive()
				if err != nil || !bytes.Contains(auth, []byte("bot\x00")) || !bytes.Contains(auth, []byte("app\x00")) || bytes.Contains(auth, []byte("private-password")) {
					done <- errors.New("invalid authentication packet")
					return
				}
				if denied {
					done <- packet(2, append([]byte{0xff, 0x15, 0x04, '#'}, []byte("28000private remote error")...))
					return
				}
				if err := packet(2, []byte{0, 0, 0, 2, 0, 0, 0}); err != nil {
					done <- err
					return
				}
				query, err := receive()
				if err != nil || string(query) != "\x03SELECT 1" {
					done <- fmt.Errorf("unexpected SQL %q: %v", query, err)
					return
				}
				column := []byte{3, 'd', 'e', 'f', 0, 0, 0, 1, '1', 0, 12, 63, 0, 1, 0, 0, 0, 3, 0, 0, 0, 0, 0}
				for i, body := range [][]byte{{1}, column, {0xfe, 0, 0, 2, 0}, {1, '1'}, {0xfe, 0, 0, 2, 0}} {
					if err := packet(byte(i+1), body); err != nil {
						done <- err
						return
					}
				}
				_, err = receive()
				done <- err
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			err := verifyMySQL(ctx, &HTTPConfig{TLSMode: "disable"}, "db.example.com", "db.example.com:3306", "app", "bot", "private-password", func(context.Context, string, string) (net.Conn, error) { return client, nil })
			if denied {
				if databaseReason(err) != "authentication_failed" {
					t.Fatal(err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStructuredDatabaseConfig(t *testing.T) {
	for _, kind := range []string{"mysql", "postgresql"} {
		legacy := json.RawMessage(fmt.Sprintf(`{"base_url":"%s://db.example.com:15432/app","tls_mode":"verify-full"}`, kind))
		cfg, err := DecodeConnectionConfig(kind, 1, legacy)
		if err != nil || cfg.Host != "db.example.com" || cfg.Port != 15432 || cfg.Database != "app" || cfg.BaseURL != "" || cfg.TLSMode != "verify-full" {
			t.Fatalf("legacy config changed: %+v %v", cfg, err)
		}
		cfg = &HTTPConfig{Host: "db.example.com", Database: "app", TLSMode: "disable"}
		if err := validateDatabaseConfig(kind, cfg); err != nil || cfg.Port != defaultDatabasePort(kind) {
			t.Fatal(cfg, err)
		}
		for _, host := range []string{"https://db.example.com", "db.example.com:3306", "127.0.0.1", "user@db.example.com", "db.example.com/path"} {
			cfg.Host = host
			if validateDatabaseConfig(kind, cfg) == nil {
				t.Fatalf("accepted host %s", host)
			}
		}
		cfg.Host = "db.example.com"
		if applyDatabaseFields(kind, cfg, Field[string]{}, Field[int]{Set: true, Value: 0}, Field[string]{}) == nil {
			t.Fatal("accepted explicit zero port")
		}
		if applyDatabaseFields("gitlab", cfg, Field[string]{Set: true, Value: "db.example.com"}, Field[int]{}, Field[string]{}) == nil {
			t.Fatal("HTTP accepted database fields")
		}
	}
}
