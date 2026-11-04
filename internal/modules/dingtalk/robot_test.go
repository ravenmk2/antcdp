package dingtalk

import (
	"testing"
)

func TestRobotResultDoesNotTreatHTTP200AsAcceptance(t *testing.T) {
	for _, v := range []struct {
		status     int
		body, want string
	}{{200, `{"errcode":0}`, "accepted"}, {200, `{"errcode":310000,"errmsg":"secret=must-not-escape"}`, "rejected"}, {500, `{"errcode":0}`, "rejected"}, {200, `{}`, "unknown"}, {200, `{"errcode":"0"}`, "unknown"}, {200, `bad`, "unknown"}} {
		d := robotResult(v.status, []byte(v.body))
		if d.Status != v.want {
			t.Fatalf("unexpected %s", d.Status)
		}
		if d.Reason == "secret=must-not-escape" {
			t.Fatal("raw response leaked")
		}
	}
}
func TestSignatureBindsSecretAndTimestamp(t *testing.T) {
	a := signature("SECtest", "1577262236757")
	if a == signature("SECother", "1577262236757") || a == signature("SECtest", "1577262236758") || a != signature("SECtest", "1577262236757") {
		t.Fatal("unstable or unbound signature")
	}
}
