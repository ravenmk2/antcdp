package app

import (
	"encoding/json"
	"errors"
	"testing"
)

func TestRobotSendSettlement(t *testing.T) {
	for _, tc := range []struct {
		provider, want string
		executed       *bool
	}{
		{"accepted", "succeeded", new(true)},
		{"rejected", "failed", new(true)},
		{"failed_before_submit", "failed", new(false)},
		{"unknown", "outcome_unknown", nil},
	} {
		raw, err := robotSendResult("notify", tc.provider)
		if tc.want == "succeeded" {
			var receipt map[string]string
			if err != nil || json.Unmarshal(raw, &receipt) != nil || receipt["robot_code"] != "notify" || receipt["status"] != "accepted" {
				t.Fatalf("wrong acceptance receipt: %s %v", raw, err)
			}
			continue
		}
		var failure *dingTalkFailure
		if !errors.As(err, &failure) {
			t.Fatalf("%s returned %v", tc.provider, err)
		}
		obs := failure.observation
		if obs.Status != tc.want || (obs.Executed == nil) != (tc.executed == nil) || obs.Executed != nil && *obs.Executed != *tc.executed {
			t.Fatalf("%s settled as %+v", tc.provider, obs)
		}
	}
}
