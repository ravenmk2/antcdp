package resourcecode

import (
	"strings"
	"testing"
)

func TestResourcePaths(t *testing.T) {
	for _, path := range []string{"build", "/build", "platform/reviewer", "/team:backend/reviewer", "project:shop/build"} {
		locator, err := Parse(path)
		if err != nil {
			t.Fatal(path, err)
		}
		if locator.String() != strings.TrimPrefix(path, "/") {
			t.Fatalf("unexpected canonical path %q for %q", locator.String(), path)
		}
		roundtrip, err := Parse(locator.String())
		if err != nil || roundtrip != locator {
			t.Fatal(path, "unstable locator", roundtrip, err)
		}
	}
	for _, path := range []string{
		"", "Build", "build name", "./build", "../build", `project\shop\build`,
		"project/shop/build", "/team/backend/reviewer", "team/backend", "project//build",
		"platform:reviewer", "platform:global/reviewer", "//platform/reviewer", "platform/reviewer/extra",
		"project:shop", "team:/reviewer", "unknown:shop/build", "project:shop:extra/build",
		"project:Shop/build", "project:shop/build/", "project:shop:build", "project:shop/%62uild", "project:shop/*",
	} {
		if _, err := Parse(path); err == nil {
			t.Fatalf("accepted ambiguous path %q", path)
		}
	}
}
