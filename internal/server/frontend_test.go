package server

import (
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestFrontendBookmarksAndAssets(t *testing.T) {
	dist := fstest.MapFS{
		"index.html":    {Data: []byte("root-app")},
		"ui-build.json": {Data: []byte(`{"base":"/","framework":"react","business_routes":"^/(home|admin/users)?$"}`)},
	}

	h := FrontendHandler(dist)
	for _, c := range []struct {
		method, path   string
		code           int
		location, body string
	}{
		{"GET", "/next/admin/users?q=1", 307, "/admin/users?q=1", ""},
		{"HEAD", "/next", 307, "/", ""},
		{"GET", "/next/login", 307, "/login", ""},
		{"POST", "/next/home", 405, "", ""},
		{"GET", "/next/unknown", 404, "", ""},
		{"GET", "/next//unsafe", 404, "", ""},
		{"GET", "/next/fonts/missing", 404, "", ""},
		{"GET", "/next/assets/open.js", 404, "", ""},
		{"GET", "/assets/old.js", 404, "", ""},
		{"GET", "/login", 200, "", "root-app"},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(c.method, c.path, nil))
		if w.Code != c.code || w.Header().Get("Location") != c.location || (c.body != "" && w.Body.String() != c.body) {
			t.Errorf("%s %s: %d %s", c.method, c.path, w.Code, w.Header().Get("Location"))
		}
	}
}
