package dingtalk

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

func signature(secret, timestamp string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "\n" + secret))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
func sendRobot(ctx context.Context, a Authentication, w TestInput) Diagnostic {
	b, err := robotPayload(w)
	if err != nil {
		return Diagnostic{Status: "failed_before_submit", Stage: "prepare", Reason: "invalid_message"}
	}
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	q := url.Values{"access_token": {a.Token}, "timestamp": {timestamp}, "sign": {signature(a.Secret, timestamp)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oapi.dingtalk.com/robot/send?"+q.Encode(), bytes.NewReader(b))
	if err != nil {
		return Diagnostic{Status: "failed_before_submit", Stage: "prepare", Reason: "invalid_request"}
	}
	req.Header.Set("Content-Type", "application/json")
	tr := &http.Transport{DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 25 * time.Second, DisableKeepAlives: true}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return Diagnostic{Status: "unknown", Stage: "submit", Reason: "response_unknown"}
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 {
		return Diagnostic{Status: "unknown", Stage: "response", Reason: "invalid_response"}
	}
	return robotResult(response.StatusCode, raw)
}
func robotResult(status int, body []byte) Diagnostic {
	var response struct {
		Code *int `json:"errcode"`
	}
	if json.Unmarshal(body, &response) != nil || response.Code == nil {
		return Diagnostic{Status: "unknown", Stage: "response", Reason: "invalid_response"}
	}
	if status == 200 && *response.Code == 0 {
		return Diagnostic{Status: "accepted", Stage: "submit", Reason: "provider_accepted"}
	}
	return Diagnostic{Status: "rejected", Stage: "submit", Reason: "provider_rejected"}
}

func robotPayload(w TestInput) ([]byte, error) {
	payload := map[string]any{"msgtype": w.Format}
	if w.Format == "text" {
		payload["text"] = map[string]string{"content": w.Body}
	} else {
		payload["markdown"] = map[string]string{"title": w.Title, "text": w.Body}
	}
	return json.Marshal(payload)
}
