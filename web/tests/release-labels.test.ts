import { expect, it } from "vitest";
import {
  releaseDisplayName,
  safeProjectReleaseReturn,
} from "@/features/delivery/release-labels";

it("uses the optional release name and falls back for historical or empty names", () => {
  expect(releaseDisplayName({ name: " 冬季发布 ", version_label: "1.0" })).toBe(
    "冬季发布",
  );
  expect(releaseDisplayName({ name: "  ", version_label: "1.0" })).toBe("1.0");
  expect(releaseDisplayName({ version_label: "1.0" })).toBe("1.0");
});
it.each(["/projects/7", "/admin/projects/7"])(
  "preserves the same project's overview or release filters at %s",
  (root) => {
    expect(safeProjectReleaseReturn(root, root)).toBe(root);
    const target =
      root +
      "?tab=releases&q=hello&page=3&page_size=50&status=attention&variant_id=2";
    expect(safeProjectReleaseReturn(target, root)).toBe(target);
  },
);
it.each([
  "https://example.com/projects/7",
  "//example.com/projects/7",
  "/projects/70?tab=releases",
  "/projects/7/variants?variant=2",
  "/projects/7/../8",
  "/admin/projects/7",
  "/projects/7?tab=settings",
  "/projects/7?tab=releases&tab=settings",
  "/projects/7#materials",
  "/projects/7\\other",
  "/projects/7\n",
])("rejects unsafe or unrelated release return target %s", (value) => {
  expect(safeProjectReleaseReturn(value, "/projects/7")).toBeUndefined();
});

it("removes transient creation requests from return targets so cancellation does not reopen the picker", () => {
  expect(
    safeProjectReleaseReturn(
      "/projects/7?tab=releases&q=hotfix&create=1&return_to=%2Fprojects%2F7",
      "/projects/7",
    ),
  ).toBe("/projects/7?tab=releases&q=hotfix");
});
