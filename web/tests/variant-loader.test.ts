import { RouterContextProvider } from "react-router";
import { expect, it, vi } from "vitest";
import { loader } from "@/features/delivery/VariantsPage";
import { request } from "@/lib/api";
vi.mock("@/lib/loaders", () => ({
  identityLoader: vi.fn(async () => ({ session: { user: { role: "user" } } })),
  adminLoader: vi.fn(async () => ({ session: { user: { role: "admin" } } })),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
it("reads the variant collection version using the server's default pagination", async () => {
  const collection = "/projects/3/variants";
  vi.mocked(request).mockImplementation(async (path) => {
    if (
      new URL(path, "https://example.invalid").searchParams.get("page_size") ===
      "1"
    )
      throw Error("Unsupported page size");
    return {
      data:
        path === collection
          ? { mutation_version: '"list"' }
          : { is_member: true },
      etag: "",
    } as Awaited<ReturnType<typeof request>>;
  });
  const result = await loader({
    request: new Request(
      "https://example.invalid/projects/3/variants?variant=4",
    ),
    params: { projectId: "3" },
    context: new RouterContextProvider(),
    url: new URL("https://example.invalid/projects/3/variants?variant=4"),
    pattern: "/projects/:projectId/variants",
  });
  expect(result.variantCollection).toBe('"list"');
});
