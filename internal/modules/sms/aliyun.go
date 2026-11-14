package sms

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/ravenmk2/antcdp/internal/platform/cryptox"
)

const aliyunHost = "dysmsapi.aliyuncs.com"

func digest(data string) string { s := sha256.Sum256([]byte(data)); return hex.EncodeToString(s[:]) }
func signRequest(req *http.Request, a Authentication, now time.Time, nonce string) {
	req.Header.Set("x-acs-action", "SendSms")
	req.Header.Set("x-acs-version", "2017-05-25")
	req.Header.Set("x-acs-date", now.UTC().Format("2006-01-02T15:04:05Z"))
	req.Header.Set("x-acs-signature-nonce", nonce)
	req.Header.Set("x-acs-content-sha256", digest(""))
	keys := []string{"host", "x-acs-action", "x-acs-content-sha256", "x-acs-date", "x-acs-signature-nonce", "x-acs-version"}
	sort.Strings(keys)
	canonical := ""
	for _, k := range keys {
		v := req.Header.Get(k)
		if k == "host" {
			v = req.URL.Host
		}
		canonical += k + ":" + strings.TrimSpace(v) + "\n"
	}
	signed := strings.Join(keys, ";")
	request := req.Method + "\n/\n" + req.URL.RawQuery + "\n" + canonical + "\n" + signed + "\n" + digest("")
	mac := hmac.New(sha256.New, []byte(a.AccessKeySecret))
	mac.Write([]byte("ACS3-HMAC-SHA256\n" + digest(request)))
	req.Header.Set("Authorization", "ACS3-HMAC-SHA256 Credential="+a.AccessKeyID+",SignedHeaders="+signed+",Signature="+hex.EncodeToString(mac.Sum(nil)))
}
func sendAliyun(ctx context.Context, _ Profile, a Authentication, to string, c Content) SendLog {
	params, _ := json.Marshal(c.Parameters)
	query := url.Values{"PhoneNumbers": {to}, "SignName": {c.SignName}, "TemplateCode": {c.RemoteID}, "TemplateParam": {string(params)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+aliyunHost+"/?"+strings.ReplaceAll(query.Encode(), "+", "%20"), nil)
	if err != nil {
		return SendLog{Status: "failed_before_submit", Stage: "prepare", Reason: "invalid_request"}
	}
	signRequest(req, a, time.Now(), cryptox.ID())
	tr := &http.Transport{DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12}, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 25 * time.Second, DisableKeepAlives: true}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return SendLog{Status: "unknown", Stage: "submit", Reason: "response_unknown"}
	}
	defer func() { _ = response.Body.Close() }()
	b, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil || len(b) > 64<<10 {
		return SendLog{Status: "unknown", Stage: "response", Reason: "invalid_response"}
	}
	return aliyunResult(response.StatusCode, b)
}
func aliyunResult(status int, b []byte) SendLog {
	var response struct {
		Code      string
		RequestID string `json:"RequestId"`
		BizID     string `json:"BizId"`
	}
	if json.Unmarshal(b, &response) != nil || response.Code == "" {
		return SendLog{Status: "unknown", Stage: "response", Reason: "invalid_response"}
	}
	out := SendLog{Status: "rejected", Stage: "submit", Reason: "provider_rejected"}
	if status == 200 && response.Code == "OK" {
		out.Status = "accepted"
		out.Reason = "provider_accepted"
	}
	if regexp.MustCompile(`^[A-Za-z0-9-]{1,128}$`).MatchString(response.RequestID) {
		out.ProviderRequestID = response.RequestID
	}
	if regexp.MustCompile(`^[A-Za-z0-9^_-]{1,128}$`).MatchString(response.BizID) {
		out.ProviderMessageID = response.BizID
	}
	return out
}
