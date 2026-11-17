package resourcecode

import "testing"

func TestResourcePaths(t *testing.T) {
	for _, path := range []string{"build", "/build", "platform/reviewer", "/team/backend/reviewer", "project/shop/build"} {
		locator, err := Parse(path)
		if err != nil {
			t.Fatal(path, err)
		}
		roundtrip, err := Parse(locator.String())
		if err != nil || roundtrip != locator {
			t.Fatal(path, "unstable locator", roundtrip, err)
		}
	}
	for _, path := range []string{"", "Build", "team/backend", "project/shop/build/", "//platform/reviewer", "project//build", "./build", "../build", `project\shop\build`, "project:shop:build", "project/shop/%62uild", "project/shop/*", "platform/reviewer/extra", "build name"} {
		if _, err := Parse(path); err == nil {
			t.Fatalf("accepted ambiguous path %q", path)
		}
	}
}
