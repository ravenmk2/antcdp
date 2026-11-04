package email

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime"
	"mime/multipart"
	"net/mail"
	"strings"
	"testing"
)

func TestTemplateBoundaries(t *testing.T) {
	tpl := Template{EngineID: "go_template", EngineVersion: 1, Subject: "{{.title}}", BodyFormat: "html", Body: `<p>{{.name}}</p><ul>{{range .items}}<li>{{.name}}</li>{{end}}</ul>`, Parameters: map[string]Parameter{"title": {Type: "string", Required: true}, "name": {Type: "string", Required: true}, "items": {Type: "array", Required: true, Items: &Parameter{Type: "object", Properties: map[string]Parameter{"name": {Type: "string", Required: true}}}}}}
	values := map[string]any{"title": "测试", "name": "<script>alert(1)</script>", "items": []any{map[string]any{"name": "条目"}}}
	out, err := Render(tpl, values)
	if err != nil || !strings.Contains(out.Body, "&lt;script&gt;") || !strings.Contains(out.Body, "<li>条目</li>") {
		t.Fatal("HTML/context rendering failed", err)
	}
	for name, mutate := range map[string]func(*Template, map[string]any){"missing": func(_ *Template, p map[string]any) { delete(p, "name") }, "wrong_type": func(_ *Template, p map[string]any) { p["title"] = 5.0 }, "header_injection": func(_ *Template, p map[string]any) { p["title"] = "x\r\nBcc: victim@example.com" }, "unknown": func(_ *Template, p map[string]any) { p["extra"] = "x" }, "recursive": func(v *Template, _ map[string]any) {
		v.Body = `{{define "loop"}}{{template "loop"}}{{end}}{{template "loop"}}`
	}, "format_bomb": func(v *Template, _ map[string]any) { v.Body = `{{printf "%999999999s" .name}}` }, "unknown_engine": func(v *Template, _ map[string]any) { v.EngineID = "unregistered" }, "nested_range": func(v *Template, _ map[string]any) {
		v.Body = `{{range .items}}{{range $.items}}{{range $.items}}{{.name}}{{end}}{{end}}{{end}}`
	}} {
		t.Run(name, func(t *testing.T) {
			copy := cloneJSON(tpl)
			input := cloneJSON(values)
			mutate(&copy, input)
			if _, err := Render(copy, input); err == nil {
				t.Fatal("unsafe or invalid template accepted")
			}
		})
	}
}
func TestMIMEUnicodeAlternativeAttachments(t *testing.T) {
	data, err := mailBytes("sender@example.com", "团队通知", "reader@example.com", "fixed@antcdp.local", Content{Subject: "中文主题", BodyFormat: "html", Body: "<p>正文</p>", TextBody: "正文"}, []Attachment{{Name: "说明.txt", Data: []byte("附件内容")}})
	if err != nil {
		t.Fatal(err)
	}
	m, err := mail.ReadMessage(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(m.Header.Get("Subject"))
	if err != nil || subject != "中文主题" {
		t.Fatal("subject encoding")
	}
	kind, params, err := mime.ParseMediaType(m.Header.Get("Content-Type"))
	if err != nil || kind != "multipart/mixed" {
		t.Fatal("mixed envelope")
	}
	reader := multipart.NewReader(m.Body, params["boundary"])
	body, err := reader.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	kind, _, _ = mime.ParseMediaType(body.Header.Get("Content-Type"))
	if kind != "multipart/alternative" {
		t.Fatal("alternative missing")
	}
	file, err := reader.NextPart()
	if err != nil {
		t.Fatal(err)
	}
	_, params, err = mime.ParseMediaType(file.Header.Get("Content-Disposition"))
	if err != nil || params["filename"] != "说明.txt" {
		t.Fatal("filename encoding")
	}
	decoded, err := io.ReadAll(base64.NewDecoder(base64.StdEncoding, file))
	if err != nil || string(decoded) != "附件内容" {
		t.Fatal("attachment bytes")
	}
	if _, err = reader.NextPart(); err != io.EOF {
		t.Fatal("unexpected part")
	}
}
func TestSenderDefaultsAndIdentity(t *testing.T) {
	names := []SenderName{{Name: "通知", Default: true}, {Name: "运维"}}
	if err := senderNames(names, nil); err != nil {
		t.Fatal(err)
	}
	first := names[0].ID
	copy := cloneJSON(names)
	copy[0].Name = "新名称"
	if err := senderNames(copy, names); err != nil || copy[0].ID != first {
		t.Fatal("stable identity", err)
	}
	copy[1].Default = true
	if senderNames(copy, names) == nil {
		t.Fatal("multiple defaults accepted")
	}
	copy = cloneJSON(names)
	copy[0].ID = "foreign"
	if senderNames(copy, names) == nil {
		t.Fatal("foreign sender accepted")
	}
}
