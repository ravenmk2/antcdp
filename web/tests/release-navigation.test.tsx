import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ReleaseWorkflow } from "@/features/delivery/ReleaseWorkflow";
import { ReleasePanel } from "@/features/delivery/ReleasePanel";
import type { Flow, MaterialSet, Release } from "@/features/delivery/releases";
import type { Variant } from "@/shared/delivery";
import { request } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<object>()),
  request: vi.fn(),
}));
const api = vi.mocked(request);
beforeEach(() => {
  api.mockReset();
});

vi.mock("@/features/delivery/ReleaseRepositories", () => ({
  ReleaseRepositories: () => <p>仓库检查区</p>,
}));
vi.mock("@/features/delivery/ReleaseEditor", () => ({
  ReleaseEditor: ({
    kind,
    close,
    saved,
  }: {
    kind: string;
    close: () => void;
    saved: () => void;
  }) => (
    <div role="dialog" aria-label={kind}>
      <button onClick={close}>关闭编辑器</button>
      <button onClick={() => saved()}>模拟保存成功</button>
    </div>
  ),
}));
afterEach(cleanup);

const release: Release = {
  id: "1",
  version_label: "1.0",
  tag_name: "v1.0",
  description_md: "",
  status: "draft",
  updated_at: "2026-11-04",
  etag: "r1",
};
const flow: Flow = {
  can_manage: true,
  changes: [],
  manifests: [],
  operations: [],
  steps: [],
};
const materials: MaterialSet = { items: [], repositories: [], can_edit: true };
function releaseDetail(
  query = "",
  overrides: { release?: Release; manage?: boolean; flow?: Flow } = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: "/projects/1/variants",
        element: (
          <ReleasePanel
            base="/projects/1/variants/2"
            variant={
              {
                id: "2",
                name: "标准版",
                main_branch: "main",
                release_tag_prefix: "v",
              } as Variant
            }
            data={{
              release: overrides.release || release,
              materials,
              flow: overrides.flow || flow,
              list: null,
            }}
            manage={overrides.manage ?? true}
          />
        ),
      },
    ],
    {
      initialEntries: [
        "/projects/1/variants?variant=2&vview=releases&release=1&rq=hotfix&rpage=3&rsize=50" +
          query,
      ],
    },
  );
  render(<RouterProvider router={router} />);
  return router;
}
it("returns to the original project releases filters and page", () => {
  const target =
    "/projects/1?tab=releases&q=hotfix&status=attention&page=3&page_size=50&variant_id=2";
  releaseDetail("&return_to=" + encodeURIComponent(target));
  expect(
    screen.getByRole("link", { name: "返回项目发布" }).getAttribute("href"),
  ).toBe(target);
});
it("returns to project overview when that was the entry point", () => {
  releaseDetail("&return_to=" + encodeURIComponent("/projects/1"));
  expect(
    screen.getByRole("link", { name: "返回项目概览" }).getAttribute("href"),
  ).toBe("/projects/1");
});
it("falls back to the variant release list with its original filters for an invalid return target", () => {
  releaseDetail("&return_to=" + encodeURIComponent("https://example.com"));
  const href = screen
    .getByRole("link", { name: "返回标准版发布列表" })
    .getAttribute("href")!;
  const url = new URL(href, "https://antcdp.invalid");
  expect(url.pathname).toBe("/projects/1/variants");
  expect(url.searchParams.get("release")).toBeNull();
  expect(url.searchParams.get("rq")).toBe("hotfix");
  expect(url.searchParams.get("rpage")).toBe("3");
  expect(url.searchParams.get("rsize")).toBe("50");
});
it("shows a release name, its version, phase and independent unknown-result notice", () => {
  releaseDetail("", {
    release: { ...release, name: "冬季发布", status: "integrating" },
    flow: {
      ...flow,
      operations: [
        {
          id: "op1",
          kind: "merge",
          status: "unknown",
          created_at: "2026-11-04",
        },
      ],
    },
  });
  expect(
    screen.getByRole("heading", { level: 1, name: "冬季发布" }),
  ).toBeTruthy();
  expect(screen.getByText("1.0", { selector: "code" })).toBeTruthy();
  expect(screen.getByText("结果待核实")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "合并与备料" })).toBeTruthy();
});
it.each(["reviewing", "accepted", "archived"])(
  "does not offer release metadata editing in %s",
  (status) => {
    releaseDetail("", { release: { ...release, status } });
    expect(screen.queryByRole("button", { name: "编辑资料" })).toBeNull();
  },
);
it("does not offer release metadata editing to a project reader", () => {
  releaseDetail("", { manage: false, flow: { ...flow, can_manage: false } });
  expect(screen.queryByRole("button", { name: "编辑资料" })).toBeNull();
});
function workflow(
  status: string,
  hash = "",
  overrides: { flow?: Flow; set?: MaterialSet; readOnlyReason?: string } = {},
) {
  function Screen() {
    const [current, setCurrent] = useState(status);
    const [etag, setEtag] = useState(release.etag);
    return (
      <>
        <button onClick={() => setCurrent("reviewing")}>模拟进入验收</button>
        <button onClick={() => setEtag("r2")}>模拟发布资料更新</button>
        <ReleaseWorkflow
          path="/releases/1"
          release={{ ...release, status: current, etag }}
          flow={overrides.flow ?? flow}
          set={overrides.set ?? materials}
          materials={<p>材料工作区</p>}
          notes={<p>说明工作区</p>}
          readOnlyReason={overrides.readOnlyReason}
        />
      </>
    );
  }
  const router = createMemoryRouter([{ path: "/release", Component: Screen }], {
    initialEntries: ["/release" + hash],
  });
  render(<RouterProvider router={router} />);
  return router;
}
it.each(["draft", "integrating"])(
  "opens repository work first while the release is %s",
  async (status) => {
    workflow(status);
    expect(await screen.findByText("仓库检查区")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "本次变更" })
        .getAttribute("aria-current"),
    ).toBe("page");
  },
);
it.each(["reviewing", "accepted", "tagging", "archived"])(
  "opens review history first while the release is %s",
  async (status) => {
    workflow(status);
    expect(
      await screen.findByRole("heading", { name: "验收与归档" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "验收与归档" })
        .getAttribute("aria-current"),
    ).toBe("page");
  },
);
it("preserves the user's chosen workspace in the URL when the release stage changes", async () => {
  const router = workflow("draft"),
    user = userEvent.setup();
  await user.click(await screen.findByRole("link", { name: "交付材料" }));
  expect(router.state.location.hash).toBe("#materials");
  await user.click(screen.getByRole("button", { name: "模拟进入验收" }));
  expect(screen.getByText("材料工作区")).toBeTruthy();
  await act(async () => {
    await router.navigate("/release");
  });
  expect(
    screen
      .getByRole("link", { name: "验收与归档" })
      .getAttribute("aria-current"),
  ).toBe("page");
});
it("opens one creation editor when the selected variant still needs a tag prefix", async () => {
  function Screen() {
    return (
      <ReleasePanel
        base="/projects/1/variants/2"
        variant={
          {
            id: "2",
            name: "标准版",
            main_branch: "main",
            archived_at: null,
            release_tag_prefix: "",
          } as Variant
        }
        data={{
          release: null,
          materials: null,
          flow: null,
          list: {
            items: [],
            total: 0,
            page: 1,
            page_size: 20,
            mutation_version: "v1",
            can_manage: true,
          },
        }}
        manage
      />
    );
  }
  const router = createMemoryRouter(
    [
      {
        path: "/release",
        Component: Screen,
      },
    ],
    { initialEntries: ["/release?create=1"] },
  );
  render(<RouterProvider router={router} />);
  expect(await screen.findByRole("dialog", { name: "create" })).toBeTruthy();
  expect(router.state.location.search).toBe("");
});
it.each([true, false])(
  "consumes the project create request once and respects permission (%s)",
  async (manage) => {
    const variant = {
      id: "2",
      code: "standard",
      name: "标准版",
      main_branch: "main",
      release_tag_prefix: "v",
      archived_at: null,
    } as Variant;
    const router = createMemoryRouter(
      [
        {
          path: "/release",
          element: (
            <ReleasePanel
              base="/projects/1/variants/2"
              variant={variant}
              data={{
                release: null,
                materials: null,
                flow: null,
                list: {
                  items: [],
                  total: 0,
                  page: 1,
                  page_size: 20,
                  mutation_version: "v1",
                  can_manage: manage,
                },
              }}
              manage={manage}
            />
          ),
        },
      ],
      { initialEntries: ["/release?create=1"] },
    );
    render(<RouterProvider router={router} />);
    await act(async () => {});
    expect(router.state.location.search).toBe("");
    if (manage) {
      expect(screen.getByRole("dialog", { name: "create" })).toBeTruthy();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "关闭编辑器" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      await act(async () => {
        await router.revalidate();
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    } else expect(screen.queryByRole("dialog")).toBeNull();
  },
);

const scopedMaterials: MaterialSet = {
  ...materials,
  repositories: Array.from({ length: 20 }, (_, i) => ({
    id: String(i + 1),
    full_path: `team/repo-${i + 1}`,
    main_branch: "main",
    baseline_sha: "a".repeat(40),
    baseline_kind: "tag",
  })),
};
it("does not require MRs to start, but still blocks any missing scope baseline", async () => {
  const ready = workflow("draft", "", { set: scopedMaterials });
  const side = screen.getByRole("complementary", { name: "发布进度与操作" });
  expect(
    (
      within(side).getByRole("button", {
        name: "确认范围并开始",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
  cleanup();
  ready.dispose();
  workflow("draft", "", {
    set: {
      ...scopedMaterials,
      repositories: scopedMaterials.repositories.map((repo, i) =>
        i === 19 ? { ...repo, baseline_sha: "" } : repo,
      ),
    },
  });
  expect(
    (
      screen.getByRole("button", {
        name: "确认范围并开始",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("keeps freeze in the stage panel across tabs and invalidates its preview after an ETag change", async () => {
  api.mockResolvedValue({
    data: {
      preview_token: "preview-r1",
      problems: [],
      repositories: scopedMaterials.repositories.map((repo) => ({
        id: repo.id,
        full_path: repo.full_path,
        commit_sha: "b".repeat(40),
        extra: [],
        problems: [],
      })),
    },
    etag: "",
  });
  workflow("integrating", "", { set: scopedMaterials });
  const user = userEvent.setup();
  const side = screen.getByRole("complementary", { name: "发布进度与操作" });
  await user.click(
    within(side).getByRole("button", { name: "核对版本与材料" }),
  );
  const freeze = await within(side).findByRole("button", {
    name: "冻结并送验",
  });
  expect((freeze as HTMLButtonElement).disabled).toBe(false);
  await user.click(screen.getByRole("link", { name: "交付材料" }));
  expect(within(side).getByRole("button", { name: "冻结并送验" })).toBe(freeze);
  expect(screen.getByText("材料工作区")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "模拟发布资料更新" }));
  await waitFor(() => {
    const staleFreeze = within(side).queryByRole("button", {
      name: "冻结并送验",
    });
    expect(
      staleFreeze === null || (staleFreeze as HTMLButtonElement).disabled,
    ).toBe(true);
  });
  expect(api).toHaveBeenCalledOnce();
  expect(api).toHaveBeenCalledWith("/releases/1/freeze-preview", {
    method: "POST",
    etag: "r1",
    body: {},
  });
});
it("offers reconciliation instead of stage progression for an unknown remote operation", async () => {
  workflow("integrating", "", {
    set: scopedMaterials,
    flow: {
      ...flow,
      operations: [
        {
          id: "op-1",
          kind: "merge",
          status: "unknown",
          created_at: "2026-11-04",
        },
      ],
    },
  });
  const side = screen.getByRole("complementary", { name: "发布进度与操作" });
  expect(
    within(side).getByRole("button", { name: "核实远端结果" }),
  ).toBeTruthy();
  expect(
    within(side).queryByRole("button", { name: "核对版本与材料" }),
  ).toBeNull();
  expect(within(side).queryByRole("button", { name: "冻结并送验" })).toBeNull();
  expect(api).not.toHaveBeenCalled();
});
it("shows the current stage to a reader without offering write actions", () => {
  workflow("integrating", "", {
    set: { ...scopedMaterials, can_edit: false },
    flow: { ...flow, can_manage: false },
  });
  const side = screen.getByRole("complementary", { name: "发布进度与操作" });
  expect(
    within(side).getByRole("heading", { name: "合并与备料" }),
  ).toBeTruthy();
  expect(
    within(side).queryByRole("button", {
      name: /核对版本|冻结并送验|终止发布/,
    }),
  ).toBeNull();
});

it("explains parent archival instead of instructing the reader to start a draft", () => {
  workflow("draft", "", {
    flow: { ...flow, can_manage: false },
    set: { ...materials, can_edit: false },
    readOnlyReason:
      "所属变体已归档，本次发布只读。恢复变体后才能继续准备和推进发布。",
  });
  expect(screen.getByText(/所属变体已归档，本次发布只读/)).toBeTruthy();
  expect(screen.queryByText("确认仓库范围与基线后开始发布。")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认范围并开始" })).toBeNull();
  expect(screen.queryByText("尚未确定发布范围")).toBeNull();
});

it("does not enable freeze when a preview arrives after the observed release version has changed", async () => {
  let deliverPreview!: () => void;
  api.mockImplementation(
    () =>
      new Promise((resolve) => {
        deliverPreview = () =>
          resolve({
            data: { preview_token: "late-r1", problems: [], repositories: [] },
            etag: "",
          });
      }),
  );
  workflow("integrating", "", { set: scopedMaterials });
  const user = userEvent.setup();
  const side = screen.getByRole("complementary", { name: "发布进度与操作" });
  await user.click(
    within(side).getByRole("button", { name: "核对版本与材料" }),
  );
  await user.click(screen.getByRole("button", { name: "模拟发布资料更新" }));
  await act(async () => deliverPreview());
  const freeze = within(side).queryByRole("button", { name: "冻结并送验" });
  expect(freeze === null || (freeze as HTMLButtonElement).disabled).toBe(true);
  expect(api).toHaveBeenCalledOnce();
});

it("keeps a zero-MR release blocked when remote verification finds an unregistered commit", async () => {
  api.mockResolvedValue({
    data: {
      preview_token: "preview-with-extra",
      problems: [],
      repositories: scopedMaterials.repositories.map((repo, index) => ({
        id: repo.id,
        full_path: repo.full_path,
        commit_sha: "b".repeat(40),
        extra:
          index === 19
            ? [{ id: "c".repeat(40), title: "绕过 MR 的直接提交" }]
            : [],
        problems: [],
      })),
    },
    etag: "",
  });
  workflow("integrating", "", { set: scopedMaterials });
  const side = screen.getByRole("complementary", { name: "发布进度与操作" });
  await userEvent.click(
    within(side).getByRole("button", { name: "核对版本与材料" }),
  );
  expect(await screen.findByText("绕过 MR 的直接提交")).toBeTruthy();
  expect(screen.getByRole("button", { name: "补录提交" })).toBeTruthy();
  expect(within(side).queryByRole("button", { name: "冻结并送验" })).toBeNull();
  expect(
    screen.queryByRole("heading", { name: "版本与材料核对通过" }),
  ).toBeNull();
});
