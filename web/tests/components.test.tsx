import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/button";
import { Field, Input, StandaloneInput } from "@/components/fields";
import { Pagination } from "@/components/pagination";
import { DataTable, type DataColumn } from "@/components/table";
import { Modal } from "@/components/overlays";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { StageFlow } from "@/components/stage-flow";
import { useUnsaved } from "@/hooks/use-unsaved";
import { createMemoryRouter, RouterProvider, useNavigate } from "react-router";

function SavedNavigation() {
  const navigate = useNavigate();
  const markSaved = useUnsaved(true);
  return (
    <Button
      onClick={() => {
        markSaved();
        navigate("/saved");
      }}
    >
      保存并离开
    </Button>
  );
}

describe("platform components", () => {
  it("toggles shared password controls independently without submitting or losing field semantics", async () => {
    const submit = vi.fn((event) => event.preventDefault());
    const user = userEvent.setup();
    render(
      <form onSubmit={submit}>
        <Field label="当前密码" hint="请输入当前密码">
          <Input
            type="password"
            name="current"
            autoComplete="current-password"
            defaultValue="secret123"
          />
        </Field>
        <Field label="新密码">
          <Input type="password" name="next" />
        </Field>
        <StandaloneInput type="password" aria-label="连接凭据" disabled />
      </form>,
    );
    const current = screen.getByLabelText("当前密码");
    const next = screen.getByLabelText("新密码");
    await user.click(current);
    await user.click(screen.getByRole("button", { name: "显示当前密码" }));
    expect(current).toHaveAttribute("type", "text");
    expect(current).toHaveFocus();
    expect(current).toHaveValue("secret123");
    expect(current).toHaveAttribute("autocomplete", "current-password");
    expect(current).toHaveAccessibleDescription("请输入当前密码");
    expect(next).toHaveAttribute("type", "password");
    await user.tab();
    expect(screen.getByRole("button", { name: "隐藏当前密码" })).toHaveFocus();
    await user.keyboard(" ");
    expect(current).toHaveAttribute("type", "password");
    await user.keyboard(" ");
    expect(current).toHaveAttribute("type", "text");
    await user.tab();
    expect(next).toHaveFocus();
    expect(current).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "显示连接凭据" })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });
  it("prevents duplicate pending submissions", async () => {
    const onClick = vi.fn();
    render(
      <Button pending onClick={onClick}>
        保存
      </Button>,
    );
    const button = screen.getByRole("button", { name: "保存" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
  it("composes link children without rendering an idle slot", () => {
    render(
      <Button asChild>
        <a href="/projects">我的项目</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "我的项目" })).toHaveAttribute(
      "href",
      "/projects",
    );
  });
  it("uses real totals and page callbacks", async () => {
    const onChange = vi.fn();
    render(<Pagination page={2} size={10} total={35} onChange={onChange} />);
    expect(screen.getByText("共 35 条")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onChange).toHaveBeenCalledWith(3, 10);
    await userEvent.click(screen.getByRole("combobox", { name: "每页条数" }));
    await userEvent.click(await screen.findByRole("option", { name: "50" }));
    expect(onChange).toHaveBeenCalledWith(1, 50);
  });
  it("selects page sizes with the keyboard and restores focus after Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pagination page={2} size={10} total={135} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "每页条数" });
    await user.tab();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("listbox")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    await user.keyboard("{End}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(1, 100);
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("navigates to both ends and preserves a usable keyboard order", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Pagination page={3} size={10} total={105} onChange={onChange} />);
    expect(screen.getByText("3/11")).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["首页", "上一页", "下一页", "末页"]);
    await user.tab();
    expect(screen.getByLabelText("每页条数")).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "首页" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(1, 10);
    await user.click(screen.getByRole("button", { name: "上一页" }));
    expect(onChange).toHaveBeenLastCalledWith(2, 10);
    await user.click(screen.getByRole("button", { name: "末页" }));
    expect(onChange).toHaveBeenLastCalledWith(11, 10);
  });
  it("disables unavailable directions and all controls while fetching", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Pagination page={1} size={10} total={0} onChange={onChange} />,
    );
    expect(screen.getByText("共 0 条")).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    rerender(<Pagination page={3} size={10} total={27} onChange={onChange} />);
    expect(screen.getByRole("button", { name: "首页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "上一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "末页" })).toBeDisabled();
    rerender(
      <Pagination page={2} size={10} total={27} pending onChange={onChange} />,
    );
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
    expect(screen.getByLabelText("每页条数")).toBeDisabled();
  });
  it("does not invent a total or last page for remote cursor results", async () => {
    const onChange = vi.fn();
    render(<Pagination page={3} size={20} hasNext onChange={onChange} />);
    expect(screen.getByText("总数未知")).toBeInTheDocument();
    expect(screen.getByText("3/—")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "末页" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onChange).toHaveBeenLastCalledWith(4, 20);
    await userEvent.click(screen.getByRole("button", { name: "首页" }));
    expect(onChange).toHaveBeenLastCalledWith(1, 20);
  });
  it("mounts overlays on demand and supports keyboard dismissal", async () => {
    const onClose = vi.fn();
    const overlay = (open: boolean) => (
      <Modal open={open} title="消息" onClose={onClose}>
        当前没有站内消息。
      </Modal>
    );
    const { rerender } = render(overlay(false));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(overlay(true));
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("releases the navigation guard after a confirmed save", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: (
            <NavigationGuardProvider>
              <SavedNavigation />
            </NavigationGuardProvider>
          ),
        },
        { path: "/saved", element: <p>保存后的页面</p> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    await userEvent.click(screen.getByRole("button", { name: "保存并离开" }));
    expect(await screen.findByText("保存后的页面")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("shows all release stages and the current status", () => {
    render(<StageFlow status="reviewing" />);
    const flow = screen.getByRole("list", { name: "发布阶段" });
    expect(flow).toHaveTextContent("草稿合并与备料验收中待归档归档中已归档");
    expect(flow.querySelector('[data-state="current"]')).toHaveTextContent(
      "验收中",
    );
  });
  it("keeps complex tables in a horizontal container", () => {
    const columns: DataColumn<{ id: string; name: string }>[] = [
      { id: "name", header: "名称", cell: ({ row }) => row.original.name },
    ];
    const { container } = render(
      <DataTable
        data={[{ id: "1", name: "项目" }]}
        columns={columns}
        label="项目"
        rowKey={(row) => row.id}
      />,
    );
    expect(screen.getByRole("table", { name: "项目" })).toBeInTheDocument();
    expect(container.querySelector(".table-scroll")).not.toBeNull();
  });
});
