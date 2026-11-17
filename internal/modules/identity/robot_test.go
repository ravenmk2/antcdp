package identity

import (
	"errors"
	"testing"

	"github.com/ravenmk2/antcdp/internal/platform/httpx"
)

func TestRobotSupportsIndependentProfileAndStatus(t *testing.T) {
	admin := &Auth{User: &User{ID: 1, Role: "admin"}, FounderID: 1}
	robot := &User{ID: 2, AccountType: "robot", Role: "user"}
	for _, operation := range []string{"profile", "status"} {
		if err := protect(admin, robot, operation); err != nil {
			t.Fatal(operation, err)
		}
	}
	for _, operation := range []string{"role", "password", "delete"} {
		var denied *httpx.Error
		if err := protect(admin, robot, operation); !errors.As(err, &denied) || denied.Code != "ROBOT_ACCOUNT_PROTECTED" {
			t.Fatalf("%s: %v", operation, err)
		}
	}
}

func TestRobotCannotOpenLoginSession(t *testing.T) {
	if _, err := (&Service{}).openSession(nil, &User{AccountType: "robot"}, "", 0, false, Metadata{}); err == nil {
		t.Fatal("robot login accepted")
	}
}
