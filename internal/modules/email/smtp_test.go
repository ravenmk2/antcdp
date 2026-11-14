package email

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"net"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"
	"time"
)

func TestSMTPProtocol(t *testing.T) {
	certServer := httptest.NewTLSServer(nil)
	certificate := certServer.TLS.Certificates[0]
	ca := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certServer.Certificate().Raw}))
	certServer.Close()
	for _, tc := range []struct{ name, mode, final, want string }{
		{"TLS acceptance", "implicit_tls", "250 queued", "accepted"},
		{"STARTTLS acceptance", "starttls", "250 queued", "accepted"},
		{"explicit rejection", "implicit_tls", "550 rejected", "rejected"},
		{"lost final response", "starttls", "", "unknown"},
		{"no plaintext fallback", "starttls", "no-starttls", "failed_before_submit"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			done := make(chan error, 1)
			calls := 0
			dial := func(context.Context, string, int) (net.Conn, error) {
				calls++
				client, server := net.Pipe()
				go func() {
					defer func() { _ = server.Close() }()
					done <- smtpFixture(server, certificate, tc.mode, tc.final)
				}()
				return client, nil
			}
			p := Profile{Config: Config{Host: "example.com", Port: 465, TLSMode: tc.mode, FromAddress: "sender@example.com", CustomCA: ca}}
			result := sendSMTPWithDial(ctx, p, Authentication{Username: "account", Password: "test-only"}, "研发通知", "recipient@example.com", Content{Subject: "测试", BodyFormat: "html", Body: "<p>通知</p>", TextBody: "通知"}, []Attachment{{Name: "说明.txt", Data: []byte("attachment")}}, dial)
			if result.Status != tc.want || calls != 1 {
				t.Fatalf("status=%s, connections=%d; want %s and no retry", result.Status, calls, tc.want)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func smtpFixture(raw net.Conn, certificate tls.Certificate, mode, final string) error {
	_ = raw.SetDeadline(time.Now().Add(5 * time.Second))
	secure := mode == "implicit_tls"
	conn := raw
	if secure {
		conn = tls.Server(raw, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
	}
	wire := textproto.NewConn(conn)
	if err := wire.PrintfLine("220 fixture ESMTP"); err != nil {
		return err
	}
	for {
		line, err := wire.ReadLine()
		if err != nil {
			if final == "no-starttls" {
				return nil
			}
			return err
		}
		switch {
		case strings.HasPrefix(line, "EHLO "):
			capability := "250 AUTH PLAIN"
			if !secure && final != "no-starttls" {
				capability = "250 STARTTLS"
			}
			if err = wire.PrintfLine("250-fixture\r\n%s", capability); err != nil {
				return err
			}
		case line == "STARTTLS":
			if err = wire.PrintfLine("220 upgrade"); err != nil {
				return err
			}
			conn = tls.Server(raw, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
			wire = textproto.NewConn(conn)
			secure = true
		case strings.HasPrefix(line, "AUTH PLAIN "):
			value, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(line, "AUTH PLAIN "))
			if !secure || e != nil || string(value) != "\x00account\x00test-only" {
				return fmt.Errorf("authentication must use TLS and the selected credentials")
			}
			if err = wire.PrintfLine("235 authenticated"); err != nil {
				return err
			}
		case line == "MAIL FROM:<sender@example.com>", line == "RCPT TO:<recipient@example.com>":
			if err = wire.PrintfLine("250 OK"); err != nil {
				return err
			}
		case line == "DATA":
			if err = wire.PrintfLine("354 send data"); err != nil {
				return err
			}
			payload, e := wire.ReadDotBytes()
			if e != nil {
				return e
			}
			if !strings.Contains(string(payload), "multipart/alternative") || !strings.Contains(string(payload), "Content-Disposition: attachment") {
				return fmt.Errorf("missing alternative content or attachment")
			}
			if final != "" {
				return wire.PrintfLine("%s", final)
			}
			return nil
		default:
			return fmt.Errorf("unexpected SMTP command")
		}
	}
}
