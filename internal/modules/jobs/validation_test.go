package jobs

import (
	"encoding/json"
	"testing"
	"time"
)

func TestInputsAndCron(t *testing.T) {
	c := Config{Parameters: []Parameter{{Name: "branch", Label: "分支", Type: "select", Required: true, Options: []string{"main", "release"}, Default: json.RawMessage(`"main"`)}, {Name: "targets", Label: "目标", Type: "multiselect", Options: []string{"a", "b"}}}}
	if err := validateConfig(c); err != nil {
		t.Fatal(err)
	}
	raw, err := inputs(c, nil)
	if err != nil || string(raw) != `{"branch":"main"}` {
		t.Fatal(string(raw), err)
	}
	for _, provided := range []map[string]json.RawMessage{{"branch": json.RawMessage(`"unknown"`)}, {"targets": json.RawMessage(`["a","a"]`)}, {"unknown": json.RawMessage(`1`)}, {"targets": json.RawMessage(`null`)}, {"targets": json.RawMessage(` null `)}} {
		if _, err = inputs(c, provided); err == nil {
			t.Fatal("invalid input accepted", provided)
		}
	}
	after := time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC)
	next, err := nextTime(Schedule{Cron: "0 9 * * 1-5", Timezone: "Asia/Shanghai"}, after)
	if err != nil || !next.Equal(after.Add(time.Hour)) {
		t.Fatal(next, err)
	}
	for _, s := range []Schedule{{Cron: "@every 1m", Timezone: "UTC"}, {Cron: "0 0 0 * * *", Timezone: "UTC"}, {Cron: "* * * * *", Timezone: "bad-zone"}, {Cron: "0 0 31 2 *", Timezone: "UTC"}} {
		if _, err := nextTime(s, after); err == nil {
			t.Fatal("invalid schedule accepted", s)
		}
	}
}

type delayedScheduleRepo struct {
	Repository
	saved Schedule
	fire  Fire
}

func (r *delayedScheduleRepo) SaveSchedule(s *Schedule) error { r.saved = *s; return nil }
func (r *delayedScheduleRepo) SaveFire(f *Fire) error         { r.fire = *f; return nil }
func TestDelayedSchedulerAdvancesToFuture(t *testing.T) {
	at := time.Date(2026, 11, 16, 9, 30, 15, 0, time.UTC)
	due := at.Add(-2 * time.Hour).Truncate(time.Minute)
	plan := Schedule{ID: 1, Enabled: true, Cron: "* * * * *", Timezone: "UTC", Next: &due}
	repo := &delayedScheduleRepo{}
	// Even an invalid configuration records one decision, then skips accumulated
	// clock ticks rather than repeatedly firing old due times on subsequent scans.
	if err := (&Service{}).fire(repo, &Job{ID: 1, Enabled: true}, &plan, at); err != nil {
		t.Fatal(err)
	}
	if !repo.fire.ScheduledAt.Equal(due) || repo.fire.Outcome != "rejected" {
		t.Fatal(repo.fire)
	}
	if repo.saved.Next == nil || !repo.saved.Next.Equal(at.Truncate(time.Minute).Add(time.Minute)) {
		t.Fatal("schedule replayed missed ticks", repo.saved.Next)
	}
}
