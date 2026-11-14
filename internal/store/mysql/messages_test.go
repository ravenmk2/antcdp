package mysql

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ravenmk2/antcdp/internal/modules/dingtalk"
	"github.com/ravenmk2/antcdp/internal/modules/email"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/modules/install"
	"github.com/ravenmk2/antcdp/internal/modules/sms"
)

func verifyMessageManagement(t *testing.T, db *Store, installer *install.Service, admin, member *apiClient) {
	ctx := context.Background()
	store := func() (identity.Store, error) { return db, nil }
	accounts := identity.New(store)
	raw := admin.cookies["antcdp_session"].Value
	tag := func(path string) string {
		admin.call(t, "GET", path, nil, 200, nil)
		return admin.last.Header().Get("ETag")
	}
	headers := func(path string) map[string]string { return map[string]string{"If-Match": tag(path)} }
	for _, path := range []string{"/admin/email/profiles", "/admin/email/templates", "/admin/email/send-logs", "/admin/sms/profiles", "/admin/sms/templates", "/admin/sms/send-logs", "/admin/dingtalk/robots"} {
		member.call(t, "GET", path, nil, 403, nil)
	}
	mailBody := map[string]any{"name": "邮件验收", "code": "email-qa", "config": map[string]any{"host": "smtp.example.com", "port": 465, "tls_mode": "implicit_tls", "from_address": "notify@example.com"}, "sender_names": []any{map[string]any{"name": "默认名称", "default": true}}, "authentication": map[string]string{"username": "smtp-user", "password": "email-test-secret"}}
	ep := testData(admin.call(t, "POST", "/admin/email/profiles", mailBody, 201, nil))
	emailID := ep["id"].(string)
	emailPath := "/admin/email/profiles/" + emailID
	eid, _ := strconv.ParseUint(emailID, 10, 64)
	if strings.Contains(fmt.Sprint(ep), "email-test-secret") {
		t.Fatal("email secret exposed")
	}
	original := tag(emailPath)
	admin.call(t, "PATCH", emailPath, map[string]any{"name": "邮件验收"}, 200, map[string]string{"If-Match": original})
	if admin.last.Header().Get("ETag") != original {
		t.Fatal("unchanged email profile must retain its version")
	}
	admin.call(t, "PATCH", emailPath, map[string]any{"name": "未授权"}, 428, nil)
	admin.call(t, "PATCH", emailPath, map[string]any{"name": "新邮件名称"}, 200, map[string]string{"If-Match": original})
	admin.call(t, "PATCH", emailPath, map[string]any{"name": "过期覆盖"}, 412, map[string]string{"If-Match": original})
	tpl := map[string]any{"name": "邮件模板验收", "code": "email-tpl-qa", "enabled": true, "engine_id": "go_template", "engine_version": 1, "subject_template": "{{.title}}", "body_format": "html", "body_template": "<p>{{.title}}</p>", "parameter_schema": map[string]any{"title": map[string]any{"type": "string", "required": true}}, "sample_data": map[string]any{"title": "虚构样例"}}
	et := testData(admin.call(t, "POST", "/admin/email/templates", tpl, 201, nil))
	tid := et["id"].(string)
	templateID, _ := strconv.ParseUint(tid, 10, 64)
	templatePath := "/admin/email/templates/" + tid
	sends := 0
	mailService := &email.Service{Identity: accounts, Store: store, Cipher: installer.EmailSecret, ETag: installer.EmailETag, Send: func(_ context.Context, p email.Profile, a email.Authentication, _ string, _ string, c email.Content, _ []email.Attachment) email.SendLog {
		sends++
		if a.Password != "email-test-secret" || c.Body != "<p>实际参数</p>" {
			t.Fatal("wrong decrypted/rendered snapshot")
		}
		admin.call(t, "PATCH", emailPath, map[string]any{"description": "发送中修改"}, 200, headers(emailPath))
		admin.call(t, "DELETE", emailPath, nil, 409, headers(emailPath))
		return email.SendLog{Status: "accepted", Stage: "submit", Reason: "smtp_accepted"}
	}}
	input := email.TestInput{Recipient: "reader@example.com", Template: &email.TemplateInput{ID: templateID, Version: et["version"].(string), Parameters: map[string]any{"title": "实际参数"}}}
	if _, _, err := mailService.Test(ctx, raw, eid, original, input, identity.Metadata{}); err == nil || sends != 0 {
		t.Fatal("stale send escaped")
	}
	result, _, err := mailService.Test(ctx, raw, eid, tag(emailPath), input, identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	delivery := result.Data.(*email.SendLog)
	if delivery.Status != "accepted" || !delivery.Outdated || delivery.RecipientMask != "re***@example.com" || sends != 1 {
		t.Fatal("send snapshot lost", delivery)
	}
	logPath := "/admin/email/send-logs/" + fmt.Sprint(delivery.ID)
	history := admin.call(t, "GET", logPath, nil, 200, nil)
	if strings.Contains(fmt.Sprint(history), "实际参数") || strings.Contains(fmt.Sprint(history), "reader@example.com") {
		t.Fatal("log leaked payload")
	}
	admin.call(t, "DELETE", emailPath, nil, 204, headers(emailPath))
	admin.call(t, "GET", templatePath, nil, 200, nil)
	admin.call(t, "GET", logPath, nil, 200, nil)
	var encrypted string
	if err = db.db.GetContext(ctx, &encrypted, "SELECT secret_ciphertext FROM email_profile WHERE id=?", eid); err == nil {
		t.Fatal("deleted credentials retained")
	}
	sp := testData(admin.call(t, "POST", "/admin/sms/profiles", map[string]any{"name": "短信验收", "code": "sms-qa", "config": map[string]any{"provider": "aliyun_sms"}, "authentication": map[string]string{"access_key_id": "LTAItestkey12345", "access_key_secret": "sms-test-secret"}}, 201, nil))
	smsID := sp["id"].(string)
	sid, _ := strconv.ParseUint(smsID, 10, 64)
	smsPath := "/admin/sms/profiles/" + smsID
	st := testData(admin.call(t, "POST", "/admin/sms/templates", map[string]any{"name": "短信模板验收", "code": "sms-tpl-qa", "enabled": true, "mode": "remote", "profile_id": smsID, "sign_name": "测试签名", "remote_template_id": "SMS_123", "provider_parameters": map[string]string{"code": "abstract_code"}, "parameter_schema": map[string]any{"abstract_code": map[string]any{"type": "string", "required": true}}, "sample_data": map[string]any{"abstract_code": "001234"}}, 201, nil))
	stid := st["id"].(string)
	stID, _ := strconv.ParseUint(stid, 10, 64)
	smsTemplatePath := "/admin/sms/templates/" + stid
	admin.call(t, "DELETE", smsPath, nil, 409, headers(smsPath))
	admin.call(t, "PATCH", smsPath, map[string]any{"name": "跨模块版本"}, 412, map[string]string{"If-Match": tag(templatePath)})
	smsSends := 0
	smsService := &sms.Service{Identity: accounts, Store: store, Cipher: installer.SMSSecret, ETag: installer.SMSETag, Send: func(_ context.Context, _ sms.Profile, a sms.Authentication, _ string, c sms.Content) sms.SendLog {
		smsSends++
		if c.Parameters["code"] != "001234" || a.AccessKeySecret != "sms-test-secret" {
			t.Fatal("SMS mapping or secret incorrect")
		}
		return sms.SendLog{Status: "unknown", Stage: "submit", Reason: "response_unknown"}
	}}
	smsResult, _, err := smsService.Test(ctx, raw, sid, tag(smsPath), sms.TestInput{Recipient: "13800138000", Template: &sms.TemplateInput{ID: stID, Version: st["version"].(string), Parameters: map[string]any{"abstract_code": "001234"}}}, identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	sl := smsResult.Data.(*sms.SendLog)
	if sl.Status != "unknown" || smsSends != 1 {
		t.Fatal("SMS retry or wrong result")
	}
	local := testData(admin.call(t, "POST", "/admin/sms/templates", map[string]any{"name": "本地模拟验收", "code": "local-sms-qa", "enabled": true, "mode": "local", "profile_id": "0", "engine_id": "go_template", "engine_version": 1, "body_template": "你好 {{.name}}", "parameter_schema": map[string]any{"name": map[string]any{"type": "string", "required": true}}, "sample_data": map[string]any{"name": "样例"}}, 201, nil))
	localPath := "/admin/sms/templates/" + local["id"].(string)
	rendered := testData(admin.call(t, "POST", localPath+"/simulate", map[string]any{"parameters": map[string]any{"name": "模拟"}}, 200, headers(localPath)))
	if rendered["body"] != "你好 模拟" {
		t.Fatal("local rendering")
	}
	var logCount int
	if err = db.db.GetContext(ctx, &logCount, "SELECT COUNT(*) FROM sms_send_log"); err != nil || logCount != 1 {
		t.Fatal("simulation wrote send log", err)
	}
	admin.call(t, "DELETE", smsTemplatePath, nil, 204, headers(smsTemplatePath))
	admin.call(t, "DELETE", smsPath, nil, 204, headers(smsPath))
	admin.call(t, "GET", "/admin/sms/send-logs/"+fmt.Sprint(sl.ID), nil, 200, nil)
	robot := testData(admin.call(t, "POST", "/admin/dingtalk/robots", map[string]any{"name": "机器人验收", "code": "robot-qa", "authentication": map[string]string{"access_token": strings.Repeat("a", 32), "secret": "SEC" + strings.Repeat("b", 32)}}, 201, nil))
	robotID := robot["id"].(string)
	rid, _ := strconv.ParseUint(robotID, 10, 64)
	robotPath := "/admin/dingtalk/robots/" + robotID
	if _, ok := robot["keyword"]; ok {
		t.Fatal("removed keyword exposed in robot response")
	}
	var config string
	if err := db.db.GetContext(ctx, &config, "SELECT config FROM dingtalk_robot WHERE id=?", rid); err != nil || config != "{}" {
		t.Fatalf("robot configuration contains duplicated fields: %q (%v)", config, err)
	}
	robotService := &dingtalk.Service{Identity: accounts, Store: store, Cipher: installer.DingTalkSecret, ETag: installer.DingTalkETag, Send: func(_ context.Context, _ dingtalk.Authentication, w dingtalk.TestInput) dingtalk.Diagnostic {
		if w.Format != "markdown" {
			t.Fatal("robot snapshot")
		}
		admin.call(t, "PATCH", robotPath, map[string]any{"description": "发送中修改"}, 200, headers(robotPath))
		return dingtalk.Diagnostic{Status: "accepted", Stage: "submit", Reason: "provider_accepted"}
	}}
	dr, _, err := robotService.Test(ctx, raw, rid, tag(robotPath), dingtalk.TestInput{Format: "markdown", Title: "标题", Body: "测试内容"}, identity.Metadata{})
	if err != nil {
		t.Fatal(err)
	}
	diag := dr.Data.(*dingtalk.Diagnostic)
	if diag.Status != "accepted" || !diag.Outdated {
		t.Fatal("robot result lost")
	}
	// Retention and interrupted-run recovery do not repeat any network action.
	if _, err = db.db.ExecContext(ctx, "UPDATE email_send_log SET started_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 31 DAY)"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.db.ExecContext(ctx, "UPDATE sms_send_log SET status='in_progress',started_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 2 MINUTE)"); err != nil {
		t.Fatal(err)
	}
	if err = email.Clean(ctx, db, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err = sms.Clean(ctx, db, time.Now()); err != nil {
		t.Fatal(err)
	}
	admin.call(t, "GET", logPath, nil, 404, nil)
	var status string
	if err = db.db.GetContext(ctx, &status, "SELECT status FROM sms_send_log WHERE id=?", sl.ID); err != nil || status != "unknown" || smsSends != 1 {
		t.Fatal("recovery retried", err)
	}
	var jsonLog []byte
	if err = db.db.GetContext(ctx, &jsonLog, "SELECT snapshot FROM sms_send_log WHERE id=?", sl.ID); err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if json.Unmarshal(jsonLog, &stored) != nil || strings.Contains(string(jsonLog), "001234") {
		t.Fatal("runtime SMS values retained")
	}
}
