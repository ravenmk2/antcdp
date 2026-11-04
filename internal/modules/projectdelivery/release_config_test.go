package projectdelivery

import (
	"os"
	"testing"
)

func TestReleaseConfigKeys(t *testing.T) {
	for _, tc := range []struct {
		format, text string
		pass         bool
	}{
		{"json", `{"a":1,"a":2}`, false}, {"json", `{"a":{"b":[1,2]}}`, true}, {"yaml", "service:\n  port: 80\n  port: 81", false}, {"yaml", "- item", false}, {"toml", "[api]\nport=80", true}, {"ini", "[api]\nport=80", true}, {"properties", "api\\.port=80\napi.port=81", false}, {"properties", "message=hello\\\n world", true},
	} {
		_, e := parseConfig([]byte(tc.text), MaterialInfo{Format: tc.format, Mode: "delta"})
		if (e == nil) != tc.pass {
			t.Errorf("%s: expected pass=%v, got %v", tc.format, tc.pass, e)
		}
	}
}
func TestReleaseConflictUsesTargetAndKeySegments(t *testing.T) {
	root, e := os.OpenRoot(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer func() { _ = root.Close() }()
	rows := []Material{}
	for n, body := range []string{`{"api":{"port":80}}`, `{"api.port":81}`, `{"api":{"port":82}}`, `{"api":"override"}`} {
		key := string(rune('a' + n))
		if e = root.WriteFile(key, []byte(body), 0600); e != nil {
			t.Fatal(e)
		}
		rows = append(rows, Material{MaterialInfo: MaterialInfo{Kind: "config", Format: "json", Mode: "delta", Target: "api.json", Filename: "api.json"}, ID: uint64(n + 1), StorageKey: key})
	}
	issues, e := materialConflicts(root, rows[:2])
	if e != nil || len(issues) != 0 {
		t.Fatal("literal dots treated as nesting", issues, e)
	}
	issues, e = materialConflicts(root, rows)
	if e != nil || len(issues) != 2 {
		t.Fatal("conflicts", issues, e)
	}
	rows[2].Repository = "99"
	rows[3].Target = "worker.json"
	issues, e = materialConflicts(root, rows)
	if e != nil || len(issues) != 0 {
		t.Fatal("target isolation", issues, e)
	}
}
