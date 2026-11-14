package email

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

func smtpDial(ctx context.Context, host string, port int) (net.Conn, error) {
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	if len(ips) == 0 {
		return nil, errors.New("no address")
	}
	for _, v := range ips {
		if !v.IP.IsGlobalUnicast() || v.IP.IsLoopback() || v.IP.IsLinkLocalUnicast() {
			return nil, errors.New("restricted address")
		}
	}
	var last error
	for _, v := range ips {
		conn, e := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", net.JoinHostPort(v.IP.String(), strconv.Itoa(port)))
		if e == nil {
			return conn, nil
		}
		last = e
	}
	return nil, last
}
func sendSMTP(ctx context.Context, p Profile, a Authentication, sender, to string, c Content, files []Attachment) SendLog {
	return sendSMTPWithDial(ctx, p, a, sender, to, c, files, smtpDial)
}

func sendSMTPWithDial(ctx context.Context, p Profile, a Authentication, sender, to string, c Content, files []Attachment, dial func(context.Context, string, int) (net.Conn, error)) SendLog {
	id := cryptox.ID() + "@antcdp.local"
	payload, err := mailBytes(p.Config.FromAddress, sender, to, id, c, files)
	if err != nil {
		return SendLog{Status: "failed_before_submit", Stage: "mime", Reason: "mime_invalid"}
	}
	conn, err := dial(ctx, p.Config.Host, p.Config.Port)
	if err != nil {
		return SendLog{Status: "failed_before_submit", Stage: "connect", Reason: "connection_failed"}
	}
	defer func() { _ = conn.Close() }()
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)
	rawConn := conn
	stop := context.AfterFunc(ctx, func() { _ = rawConn.Close() })
	defer stop()
	roots, err := x509.SystemCertPool()
	if err != nil {
		roots = x509.NewCertPool()
	}
	if p.Config.CustomCA != "" && !roots.AppendCertsFromPEM([]byte(p.Config.CustomCA)) {
		return SendLog{Status: "failed_before_submit", Stage: "tls", Reason: "certificate_invalid"}
	}
	cfg := &tls.Config{ServerName: p.Config.Host, MinVersion: tls.VersionTLS12, RootCAs: roots}
	if p.Config.TLSMode == "implicit_tls" {
		secure := tls.Client(conn, cfg)
		if err = secure.HandshakeContext(ctx); err != nil {
			return SendLog{Status: "failed_before_submit", Stage: "tls", Reason: "tls_failed"}
		}
		conn = secure
	}
	client, err := smtp.NewClient(conn, p.Config.Host)
	if err != nil {
		return smtpFailure(err, "greeting", false)
	}
	defer func() { _ = client.Close() }()
	if p.Config.TLSMode == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return SendLog{Status: "failed_before_submit", Stage: "tls", Reason: "starttls_unavailable"}
		}
		if err = client.StartTLS(cfg); err != nil {
			return smtpFailure(err, "tls", false)
		}
	}
	if err = client.Auth(smtp.PlainAuth("", a.Username, a.Password, p.Config.Host)); err != nil {
		return smtpFailure(err, "authentication", false)
	}
	if err = client.Mail(p.Config.FromAddress); err != nil {
		return smtpFailure(err, "sender", false)
	}
	if err = client.Rcpt(to); err != nil {
		return smtpFailure(err, "recipient", false)
	}
	writer, err := client.Data()
	if err != nil {
		return smtpFailure(err, "data", false)
	}
	if _, err = writer.Write(payload); err != nil {
		return smtpFailure(err, "data", true)
	}
	if err = writer.Close(); err != nil {
		return smtpFailure(err, "submit", true)
	}
	// The final DATA response is authoritative. QUIT failure must not erase acceptance.
	return SendLog{Status: "accepted", Stage: "submit", Reason: "smtp_accepted", ResponseCode: "250", MessageID: id}
}
func smtpFailure(err error, stage string, submitted bool) SendLog {
	d := SendLog{Status: "failed_before_submit", Stage: stage, Reason: "smtp_failed"}
	var response *textproto.Error
	if errors.As(err, &response) {
		d.Status = "rejected"
		d.Reason = "smtp_rejected"
		d.ResponseCode = strconv.Itoa(response.Code)
	} else if submitted {
		d.Status = "unknown"
		d.Reason = "response_unknown"
	}
	return d
}
func mailBytes(from, sender, to, id string, c Content, files []Attachment) ([]byte, error) {
	var body bytes.Buffer
	outer := multipart.NewWriter(&body)
	contentType := `multipart/mixed; boundary="` + outer.Boundary() + `"`
	if c.BodyFormat == "html" && c.TextBody != "" {
		var alt bytes.Buffer
		writer := multipart.NewWriter(&alt)
		if err := writeTextPart(writer, "text/plain", c.TextBody); err != nil {
			return nil, err
		}
		if err := writeTextPart(writer, "text/html", c.Body); err != nil {
			return nil, err
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
		h := textproto.MIMEHeader{}
		h.Set("Content-Type", `multipart/alternative; boundary="`+writer.Boundary()+`"`)
		part, err := outer.CreatePart(h)
		if err != nil {
			return nil, err
		}
		if _, err = part.Write(alt.Bytes()); err != nil {
			return nil, err
		}
	} else {
		kind := "text/plain"
		if c.BodyFormat == "html" {
			kind = "text/html"
		}
		if err := writeTextPart(outer, kind, c.Body); err != nil {
			return nil, err
		}
	}
	for _, f := range files {
		h := textproto.MIMEHeader{}
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": f.Name}))
		h.Set("Content-Transfer-Encoding", "base64")
		part, err := outer.CreatePart(h)
		if err != nil {
			return nil, err
		}
		encoded := base64.StdEncoding.EncodeToString(f.Data)
		for len(encoded) > 0 {
			n := min(76, len(encoded))
			if _, err = io.WriteString(part, encoded[:n]+"\r\n"); err != nil {
				return nil, err
			}
			encoded = encoded[n:]
		}
	}
	if err := outer.Close(); err != nil {
		return nil, err
	}
	if body.Len() > 16<<20 {
		return nil, errors.New("MIME size limit")
	}
	headers := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMessage-ID: <%s>\r\nMIME-Version: 1.0\r\nContent-Type: %s\r\n\r\n", (&mail.Address{Name: sender, Address: from}).String(), (&mail.Address{Address: to}).String(), mime.QEncoding.Encode("UTF-8", c.Subject), time.Now().UTC().Format(time.RFC1123Z), id, contentType)
	return append([]byte(headers), body.Bytes()...), nil
}
func writeTextPart(w *multipart.Writer, kind, body string) error {
	h := textproto.MIMEHeader{}
	h.Set("Content-Type", kind+`; charset="utf-8"`)
	h.Set("Content-Transfer-Encoding", "quoted-printable")
	part, err := w.CreatePart(h)
	if err != nil {
		return err
	}
	enc := quotedprintable.NewWriter(part)
	if _, err = io.WriteString(enc, strings.ReplaceAll(strings.ReplaceAll(body, "\r\n", "\n"), "\n", "\r\n")); err != nil {
		return err
	}
	return enc.Close()
}
