package sms

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestMappingAndLocalRendering(t *testing.T) {
	tpl := Template{Mode: "remote", ProfileID: 1, SignName: "测试", RemoteID: "SMS_123", Mapping: map[string]string{"code": "verification", "copy": "verification"}, Parameters: map[string]Parameter{"verification": {Type: "string", Required: true}}}
	out, err := Render(tpl, map[string]any{"verification": "001234"})
	if err != nil || out.Parameters["code"] != "001234" || out.Parameters["copy"] != "001234" {
		t.Fatal("mapping lost value", err)
	}
	for _, p := range []map[string]any{{}, {"verification": 1234.0}, {"verification": "x", "extra": "x"}} {
		if _, err = Render(tpl, p); err == nil {
			t.Fatal("invalid parameters accepted")
		}
	}
	tpl.Mode = "local"
	tpl.ProfileID = 0
	tpl.SignName = ""
	tpl.RemoteID = ""
	tpl.Mapping = nil
	tpl.EngineID = "go_template"
	tpl.EngineVersion = 1
	tpl.Body = "验证码：{{.verification}}"
	out, err = Render(tpl, map[string]any{"verification": "{{.secret}}"})
	if err != nil || out.Body != "验证码：{{.secret}}" {
		t.Fatal("values reparsed", err)
	}
	for _, source := range []string{`{{range .verification}}x{{end}}`, `{{template "x"}}`, `{{printf "%999999999s" .verification}}`, strings.Repeat("a", 4097)} {
		tpl.Body = source
		if _, err = Render(tpl, map[string]any{"verification": "x"}); err == nil {
			t.Fatal("unsupported or oversized rendering accepted")
		}
	}
}
func TestAliyunResultAndSigning(t *testing.T) {
	for _, v := range []struct {
		status     int
		body, want string
	}{{200, `{"Code":"OK","RequestId":"id-123","BizId":"456"}`, "accepted"}, {200, `{"Code":"isv.BUSINESS_LIMIT_CONTROL"}`, "rejected"}, {500, `{"Code":"InternalError"}`, "rejected"}, {200, `{}`, "unknown"}, {200, `<html>oops</html>`, "unknown"}} {
		if d := aliyunResult(v.status, []byte(v.body)); d.Status != v.want {
			t.Fatalf("wrong classification %s", d.Status)
		}
	}
	r, _ := http.NewRequest("POST", "https://dysmsapi.aliyuncs.com/?PhoneNumbers=13800000000", nil)
	a := Authentication{AccessKeyID: "testkey1", AccessKeySecret: "secret"}
	signRequest(r, a, time.Unix(0, 0), "nonce")
	signature := r.Header.Get("Authorization")
	if !strings.HasPrefix(signature, "ACS3-HMAC-SHA256 Credential=testkey1,") || strings.Contains(signature, "secret") || r.Header.Get("x-acs-version") != "2017-05-25" {
		t.Fatal("invalid signature metadata")
	}
	r2, _ := http.NewRequest("POST", "https://dysmsapi.aliyuncs.com/?PhoneNumbers=13800000001", nil)
	signRequest(r2, a, time.Unix(0, 0), "nonce")
	if r2.Header.Get("Authorization") == signature {
		t.Fatal("signature did not bind recipient")
	}
}
