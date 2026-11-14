package audit

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestPaginationAndFilter(t *testing.T) {
	at := time.Date(2026, 10, 18, 12, 0, 0, 123000000, time.FixedZone("local", 28800))
	for _, filter := range []Filter{{Page: 0, PageSize: 20}, {Page: 1000001, PageSize: 20}, {Page: 1, PageSize: 0}, {Page: 1, PageSize: 101}, {Page: 1, PageSize: 20, Query: strings.Repeat("字", 65)}, {Page: 1, PageSize: 20, ActionPrefix: "user.%"}, {Page: 1, PageSize: 20, TargetType: "user OR 1=1"}, {Page: 1, PageSize: 20, From: &at, To: &at}} {
		if filter.Validate() == nil {
			t.Errorf("accepted filter %+v", filter)
		}
	}
	if err := (Filter{Page: 1, PageSize: 20, Query: "用户", ActionPrefix: "user.", From: &at}).Validate(); err != nil {
		t.Fatal(err)
	}
	if codes := SearchActions("头像"); len(codes) != 1 || codes[0] != "user.avatar_changed" {
		t.Fatal(codes)
	}
}

func TestDetailAllowlist(t *testing.T) {
	raw := json.RawMessage(`{"password":"secret","changes":{"display_name":{"before":"甲","after":"乙","token":"secret"},"password":{"before":"secret","after":"secret"}},"cookie":"secret"}`)
	got := string(PublicDetail("user.profile_updated", raw))
	if strings.Contains(got, "secret") || !strings.Contains(got, "甲") || !strings.Contains(got, "乙") {
		t.Fatal(got)
	}
	for _, action := range []string{"auth.login_succeeded", "unknown.action", "user.password_reset"} {
		if got := string(PublicDetail(action, raw)); got != "{}" {
			t.Fatal(got)
		}
	}
	if got := string(PublicDetail("user.avatar_changed", json.RawMessage(`{"operation":"removed","storage_key":"secret"}`))); got != `{"operation":"removed"}` {
		t.Fatal(got)
	}
	if got := string(PublicDetail("settings.updated", json.RawMessage(`{"changes":{"site.name":{"before":{"password":"secret"},"after":"name"}}}`))); got != "{}" {
		t.Fatal(got)
	}
}
