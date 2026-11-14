package workspacefs

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestRequestAndPathBoundaries(t *testing.T) {
	for _, name := range []string{".system/staging/private", ".system/skills/1/version", "workspace/.system/private"} {
		if _, err := PublicPath(name, true); err == nil {
			t.Fatalf("exposed internal namespace %q", name)
		}
	}
	for _, value := range []string{"/data/private", "../outside", "a/../b", "a//b", "a/./b", "a\\b", "a\x00b", "a\nb", strings.Repeat("a", 256)} {
		if _, err := Normalize(value, false); err == nil {
			t.Fatalf("accepted ambiguous path %q", value)
		}
	}
	q := Request{Operation: "read", Path: "projects/1/中文.txt", Offset: 5}
	encoded, err := Encode(q)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decode(encoded)
	if err != nil || decoded.Path != q.Path || decoded.Offset != q.Offset || decoded.Version != Version {
		t.Fatalf("roundtrip: %+v %v", decoded, err)
	}
	for _, bad := range []string{`{"version":1,"operation":"read","root":"/"}`, `{"version":2}`, `{"version":1}{"version":1}`} {
		if _, err = Decode(base64.RawURLEncoding.EncodeToString([]byte(bad))); err == nil {
			t.Fatalf("accepted invalid request %s", bad)
		}
	}
	if _, err = Decode(base64.RawURLEncoding.EncodeToString([]byte(`{"version":1,"operation":"read","alias":{"agent_id":"42"}}`))); err == nil {
		t.Fatal("retired alias protocol accepted")
	}
	for _, name := range []string{".", ".system/staging/a", "agents", "agents/42", "agents/42/skills", "agents/42/skills/test-skill/SKILL.md", "agents/42/.skill-sync/anything"} {
		if !reserved(name) {
			t.Fatalf("unprotected path %s", name)
		}
	}
}
