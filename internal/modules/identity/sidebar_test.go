package identity

import "testing"

func TestShortcutInputBoundary(t *testing.T) {
	tag := SidebarTag("projects", 42, 1)
	for _, ids := range [][]string{nil, {"0"}, {"01"}, {"-1"}, {"1", "1"}, {"18446744073709551616"}} {
		if _, err := ValidateShortcuts("projects", ids, tag); err == nil {
			t.Fatalf("accepted invalid IDs %v", ids)
		}
	}
	for _, ids := range [][]string{{}, {"1", "18446744073709551615"}} {
		if _, err := ValidateShortcuts("projects", ids, tag); err != nil {
			t.Fatal(err)
		}
	}
	for _, invalid := range []string{"", "*", "W/" + tag, tag + ", " + tag} {
		if _, err := ValidateShortcuts("projects", []string{}, invalid); err == nil {
			t.Fatal("accepted invalid precondition", invalid)
		}
	}
}
