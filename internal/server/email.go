package server

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ravenmk2/antcdp/internal/modules/email"
	"github.com/ravenmk2/antcdp/internal/modules/identity"
	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func decodeEmail(c *gin.Context, value any) bool {
	if c.ContentType() != "application/json" {
		httpx.Write(c, httpx.E(415, "UNSUPPORTED_MEDIA_TYPE", "请使用 JSON 请求"))
		return false
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512<<10)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			httpx.Write(c, httpx.E(413, "PAYLOAD_TOO_LARGE", "请求内容过大"))
		} else {
			httpx.Write(c, httpx.Invalid("body", "invalid_json"))
		}
		return false
	}
	if d.Decode(new(any)) != io.EOF {
		httpx.Write(c, httpx.Invalid("body", "single_json_object_required"))
		return false
	}
	return true
}

func registerEmail(api *gin.RouterGroup, o Options) {
	s := &email.Service{Identity: o.Identity, Cipher: o.Installer.EmailSecret, ETag: o.Installer.EmailETag, Store: func() (identity.Store, error) {
		st, ok := o.Installer.Backend().(identity.Store)
		if !ok {
			return nil, httpx.E(503, "INSTANCE_NOT_READY", "系统尚未就绪")
		}
		return st, nil
	}}
	finish := func(c *gin.Context, r email.Result, a *identity.Auth, e error, status int) {
		if !collaborationFinish(c, o, a, e) {
			return
		}
		if r.Tag != "" {
			c.Header("ETag", r.Tag)
		}
		if status == 204 {
			c.Status(204)
			return
		}
		httpx.Data(c, status, r.Data)
	}
	base := "/admin/email"
	for _, kind := range []string{"profiles", "templates", "send-logs", "template-engines"} {
		api.GET(base+"/"+kind, func(c *gin.Context) {
			f, ok := emailFilter(c)
			if !ok {
				return
			}
			r, a, e := s.List(c.Request.Context(), rawSession(c), kind, f)
			finish(c, r, a, e, 200)
		})
	}
	api.POST(base+"/profiles", func(c *gin.Context) {
		var w email.ProfileWrite
		if !decodeEmail(c, &w) {
			return
		}
		r, a, e := s.Profile(c.Request.Context(), rawSession(c), 0, "create", "", w, metadata(c))
		finish(c, r, a, e, 201)
	})
	for _, route := range []struct{ method, path, op string }{{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"}, {"PUT", "/authentication", "authentication"}, {"GET", "/diagnostics", "diagnostics"}} {
		api.Handle(route.method, base+"/profiles/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok {
				return
			}
			var w email.ProfileWrite
			if route.op == "update" {
				if !decodeEmail(c, &w) {
					return
				}
			}
			if route.op == "authentication" {
				var auth email.Authentication
				if !decodeEmail(c, &auth) {
					return
				}
				w.Authentication = &auth
			}
			r, a, e := s.Profile(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), w, metadata(c))
			status := 200
			if route.op == "delete" {
				status = 204
			}
			finish(c, r, a, e, status)
		})
	}
	api.POST(base+"/templates", func(c *gin.Context) {
		var w email.Template
		if !decodeEmail(c, &w) {
			return
		}
		r, a, e := s.Template(c.Request.Context(), rawSession(c), 0, "create", "", w, metadata(c))
		finish(c, r, a, e, 201)
	})
	api.POST(base+"/templates/preview", func(c *gin.Context) {
		var w email.PreviewInput
		if !decodeEmail(c, &w) {
			return
		}
		r, a, e := s.Preview(c.Request.Context(), rawSession(c), w)
		finish(c, r, a, e, 200)
	})
	for _, route := range []struct{ method, path, op string }{{"GET", "", "get"}, {"PATCH", "", "update"}, {"DELETE", "", "delete"}, {"GET", "/diagnostics", "diagnostics"}} {
		api.Handle(route.method, base+"/templates/:id"+route.path, func(c *gin.Context) {
			id, ok := collaborationID(c, "id")
			if !ok {
				return
			}
			var w email.Template
			if route.op == "update" {
				if !decodeEmail(c, &w) {
					return
				}
			}
			r, a, e := s.Template(c.Request.Context(), rawSession(c), id, route.op, c.GetHeader("If-Match"), w, metadata(c))
			status := 200
			if route.op == "delete" {
				status = 204
			}
			finish(c, r, a, e, status)
		})
	}
	api.GET(base+"/send-logs/:id", func(c *gin.Context) {
		id, ok := collaborationID(c, "id")
		if !ok {
			return
		}
		r, a, e := s.Log(c.Request.Context(), rawSession(c), id)
		finish(c, r, a, e, 200)
	})
	uploads := make(chan struct{}, 4)
	api.POST(base+"/profiles/:id/test", func(c *gin.Context) {
		id, ok := collaborationID(c, "id")
		if !ok {
			return
		}
		a, e := o.Identity.AdminAccess(c.Request.Context(), rawSession(c), nil)
		if !collaborationFinish(c, o, a, e) {
			return
		}
		select {
		case uploads <- struct{}{}:
			defer func() { <-uploads }()
		default:
			httpx.Write(c, httpx.E(429, "RATE_LIMITED", "邮件发送繁忙"))
			return
		}
		var w email.TestInput
		kind, _, _ := mime.ParseMediaType(c.GetHeader("Content-Type"))
		if kind == "multipart/form-data" {
			if !emailMultipart(c, &w) {
				return
			}
		} else if !decodeEmail(c, &w) {
			return
		}
		defer func() {
			for i := range w.Attachments {
				clear(w.Attachments[i].Data)
			}
		}()
		r, a, e := s.Test(c.Request.Context(), rawSession(c), id, c.GetHeader("If-Match"), w, metadata(c))
		finish(c, r, a, e, 200)
	})
}
func emailMultipart(c *gin.Context, w *email.TestInput) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 12<<20)
	reader, err := c.Request.MultipartReader()
	if err != nil {
		httpx.Write(c, httpx.Invalid("body", "invalid_multipart"))
		return false
	}
	seen := false
	total := 0
	for {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			httpx.Write(c, httpx.Invalid("body", "invalid_or_oversized_multipart"))
			return false
		}
		limit := int64(512 << 10)
		if part.FormName() == "attachments" {
			limit = 5 << 20
		}
		data, e := io.ReadAll(io.LimitReader(part, limit+1))
		_ = part.Close()
		if e != nil || int64(len(data)) > limit {
			httpx.Write(c, httpx.Invalid("attachments", "too_large"))
			return false
		}
		switch part.FormName() {
		case "payload":
			if seen {
				httpx.Write(c, httpx.Invalid("payload", "duplicate"))
				return false
			}
			seen = true
			d := json.NewDecoder(strings.NewReader(string(data)))
			d.DisallowUnknownFields()
			if d.Decode(w) != nil || d.Decode(new(any)) != io.EOF {
				httpx.Write(c, httpx.Invalid("payload", "invalid_json"))
				return false
			}
		case "attachments":
			total += len(data)
			_, params, _ := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
			name := params["filename"]
			if len(w.Attachments) >= 5 || total > 10<<20 || name == "" || strings.ContainsAny(name, "/\\\r\n\x00") {
				httpx.Write(c, httpx.Invalid("attachments", "invalid_file"))
				return false
			}
			w.Attachments = append(w.Attachments, email.Attachment{Name: name, Data: data})
		default:
			httpx.Write(c, httpx.Invalid("body", "unknown_part"))
			return false
		}
	}
	if !seen {
		httpx.Write(c, httpx.Invalid("payload", "required"))
		return false
	}
	return true
}
func emailFilter(c *gin.Context) (email.Filter, bool) {
	f := email.Filter{Page: 1, PageSize: 20}
	for key, values := range c.Request.URL.Query() {
		if len(values) != 1 {
			httpx.Write(c, httpx.Invalid(key, "duplicate"))
			return f, false
		}
		v := values[0]
		switch key {
		case "page", "page_size":
			n, e := strconv.Atoi(v)
			if e != nil || n < 1 || key == "page_size" && n > 100 || n > 1000000 {
				httpx.Write(c, httpx.Invalid(key, "invalid_value"))
				return f, false
			}
			if key == "page" {
				f.Page = n
			} else {
				f.PageSize = n
			}
		case "q":
			if len(v) > 256 {
				httpx.Write(c, httpx.Invalid(key, "too_long"))
				return f, false
			}
			f.Query = v
		case "status":
			switch v {
			case "", "enabled", "disabled", "accepted", "rejected", "unknown", "failed_before_submit", "in_progress":
				f.Status = v
			default:
				httpx.Write(c, httpx.Invalid(key, "invalid_value"))
				return f, false
			}
		case "profile_id", "template_id", "actor_user_id":
			n, e := strconv.ParseUint(v, 10, 64)
			if e != nil || n == 0 {
				httpx.Write(c, httpx.Invalid(key, "invalid_id"))
				return f, false
			}
			switch key {
			case "profile_id":
				f.ProfileID = n
			case "template_id":
				f.TemplateID = n
			case "actor_user_id":
				f.ActorID = n
			}
		case "from", "to":
			n, e := time.Parse(time.RFC3339, v)
			if e != nil || n.Year() < 1000 || n.Year() > 9999 {
				httpx.Write(c, httpx.Invalid(key, "invalid_time"))
				return f, false
			}
			if key == "from" {
				f.From = &n
			} else {
				f.To = &n
			}
		default:
			httpx.Write(c, httpx.Invalid(key, "unsupported"))
			return f, false
		}
	}
	if f.From != nil && f.To != nil && !f.From.Before(*f.To) {
		httpx.Write(c, httpx.Invalid("to", "invalid_range"))
		return f, false
	}
	return f, true
}
