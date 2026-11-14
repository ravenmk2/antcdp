import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { request } from "@/api/client";
import { SkillPackageView } from "@/features/agents/resources/skill-package-view";
vi.mock("@/api/client", async (original) => ({
  ...(await original<typeof import("@/api/client")>()),
  request: vi.fn(),
}));
vi.mock("@/components/code-block", () => ({
  CodeBlock: ({ source, title }: { source: string; title: string }) => (
    <article aria-label={title}>{source}</article>
  ),
}));
it("opens SKILL.md, navigates the tree by keyboard, and avoids fetching binary or oversized entries", async () => {
  const mocked = vi.mocked(request);
  mocked.mockReset();
  mocked.mockImplementation(async (path) => ({
    data: {
      text: path.endsWith("SKILL.md")
        ? "---\nname: review\ndescription: Private metadata\n---\n# Read the checklist first\n\n[Checklist](references/checklist.md)\n\n<script>alert('unsafe')</script>\n\n![image](https://example.com/image.png)"
        : "Review the tests",
    },
    etag: "",
    status: 200,
  }));
  const entries = [
    {
      path: "SKILL.md",
      size_bytes: "50",
      sha256: "a",
      media_type: "text/markdown",
    },
    {
      path: "references/checklist.md",
      size_bytes: "30",
      sha256: "b",
      media_type: "text/plain",
    },
    {
      path: "assets/image.png",
      size_bytes: "100",
      sha256: "c",
      media_type: "image/png",
    },
    {
      path: "large.txt",
      size_bytes: "262145",
      sha256: "d",
      media_type: "text/plain",
    },
  ];
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SkillPackageView
        skillId="8"
        versionId="9"
        manifest={{ entries, file_count: 4, total_bytes: "262325" }}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(
    await screen.findByRole("article", { name: "Markdown 正文" }),
  ).toHaveTextContent("Read the checklist first");
  expect(screen.queryByText(/Private metadata/)).not.toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "源码" }));
  expect(screen.getByRole("button", { name: "源码" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await screen.findByRole("article", { name: "Markdown 源码" }),
  ).toHaveTextContent("name: review");
  await user.keyboard("{ArrowLeft} ");
  expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "预览" }));
  expect(screen.getByRole("button", { name: "预览" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const folder = screen.getByRole("treeitem", { name: "references" });
  await user.click(folder);
  expect(folder).toHaveAttribute("aria-expanded", "true");
  await user.keyboard("{ArrowRight}{Enter}");
  expect(
    await screen.findByRole("article", { name: "Markdown 正文" }),
  ).toHaveTextContent("Review the tests");
  await user.click(screen.getByRole("treeitem", { name: "SKILL.md" }));
  await user.click(await screen.findByRole("link", { name: "Checklist" }));
  expect(
    await screen.findByRole("article", { name: "Markdown 正文" }),
  ).toHaveTextContent("Review the tests");
  await user.click(screen.getByRole("treeitem", { name: "assets" }));
  await user.click(screen.getByRole("treeitem", { name: "image.png" }));
  expect(screen.getByText(/此文件不支持文本预览/)).toBeVisible();
  expect(screen.getByRole("link", { name: "下载 ZIP" })).toHaveAttribute(
    "href",
    "/api/v1/admin/agents/skills/8/versions/9/archive",
  );
  await user.click(screen.getByRole("treeitem", { name: "large.txt" }));
  expect(screen.getByText(/文件超过 256 KiB/)).toBeVisible();
  expect(mocked).toHaveBeenCalledTimes(2);
});
