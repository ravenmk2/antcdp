package server

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"regexp"
	"strings"
)

// FrontendHandler serves the application at the root. Existing bookmarks under
// /next are redirected only when they name a registered page.
func FrontendHandler(dist fs.FS) http.Handler {
	if dist == nil {
		return http.NotFoundHandler()
	}
	root := SPAHandler(dist)
	var build struct {
		Routes string `json:"business_routes"`
	}
	var pages *regexp.Regexp
	if data, err := fs.ReadFile(dist, "ui-build.json"); err == nil && json.Unmarshal(data, &build) == nil && build.Routes != "" {
		pages, _ = regexp.Compile(build.Routes)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/next" && !strings.HasPrefix(r.URL.Path, "/next/") {
			root.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/next")
		if path == "" {
			path = "/"
		}
		if strings.Contains(path, "//") || strings.ContainsAny(path, "\\%") {
			http.NotFound(w, r)
			return
		}
		switch strings.TrimSuffix(path, "/") {
		case "/setup", "/login", "/register", "/required-password", "/connection-error":
		default:
			if pages == nil || !pages.MatchString(path) {
				http.NotFound(w, r)
				return
			}
		}
		if r.URL.RawQuery != "" {
			path += "?" + r.URL.RawQuery
		}
		http.Redirect(w, r, path, http.StatusTemporaryRedirect)
	})
}
