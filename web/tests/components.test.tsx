import { render, screen } from "@testing-library/react";
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
    await userEvent.selectOptions(screen.getByLabelText("每页条数"), "50");
    expect(onChange).toHaveBeenCalledWith(1, 50);
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
