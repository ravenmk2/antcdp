package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPAFontCaching(t *testing.T) {
	font := "fonts/misans/" + strings.Repeat("a", 64) + ".woff2"
	otherFont := "assets/" + strings.Repeat("a", 64) + ".woff2"
	files := fstest.MapFS{
		"index.html":                  {Data: []byte("<html>app</html>")},
		font:                          {Data: []byte("font fixture")},
		otherFont:                     {Data: []byte("other font")},
		"fonts/misans/fonts.css":      {Data: []byte("@font-face {}")},
		"fonts/misans/license.pdf":    {Data: []byte("license fixture")},
		"fonts/misans/unhashed.woff2": {Data: []byte("mutable font")},
	}
	handler := SPAHandler(files)
	for _, tc := range []struct {
		name, method, path, cache, byteRange string
		status                               int
	}{
		{"font get", "GET", "/" + font, "public, max-age=31536000, immutable", "", 200},
		{"font head", "HEAD", "/" + font, "public, max-age=31536000, immutable", "", 200},
		{"font query", "GET", "/" + font + "?v=1", "public, max-age=31536000, immutable", "", 200},
		{"font range", "GET", "/" + font, "public, max-age=31536000, immutable", "bytes=0-3", 206},
		{"stylesheet", "GET", "/fonts/misans/fonts.css", "no-cache", "", 200},
		{"license", "GET", "/fonts/misans/license.pdf", "no-cache", "", 200},
		{"mutable font", "GET", "/fonts/misans/unhashed.woff2", "no-cache", "", 200},
		{"other directory", "GET", "/" + otherFont, "", "", 200},
		{"missing font", "GET", "/fonts/misans/" + strings.Repeat("b", 64) + ".woff2", "", "", 404},
		{"unsupported method", "POST", "/" + font, "", "", 405},
		{"SPA fallback", "GET", "/login", "no-store", "", 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.byteRange != "" {
				req.Header.Set("Range", tc.byteRange)
			}
			w := httptest.NewRecorder()
			handler.ServeHTTP(w, req)
			if w.Code != tc.status || w.Header().Get("Cache-Control") != tc.cache {
				t.Fatalf("got status=%d cache=%q; want status=%d cache=%q", w.Code, w.Header().Get("Cache-Control"), tc.status, tc.cache)
			}
			if tc.method == http.MethodHead && w.Body.Len() != 0 {
				t.Fatal("HEAD returned a body")
			}
		})
	}
}
