import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { Field, Input, StandaloneInput } from "@/components/fields";
import { Tabs } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { DataTable, type DataColumn } from "@/components/table";
import { Modal, OverlayCancelButton } from "@/components/overlays";
import { NavigationGuardProvider } from "@/components/navigation-guard";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
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

function SubmissionForm() {
  const errors = useFormErrors();
  const submission = useSubmission();
  return (
    <form
      ref={errors.formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submission.run(
          () =>
            Promise.reject(
              new ApiError("VALIDATION_FAILED", "保存失败", 422, [
                { code: "invalid_value", field: "name" },
              ]),
            ),
          (error) => errors.show(error, ["name"]),
        );
      }}
    >
      <ErrorNotice error={errors.error || submission.error} />
      <Field label="名称" required error={errors.fields.name}>
        <Input name="name" />
      </Field>
      <Button type="submit">保存</Button>
    </form>
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
      <Button
        render={<a href="/projects">我的项目</a>}
        nativeButton={false}
        role="link"
      />,
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
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus(),
    );
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
  it("keeps pending button content in place while showing an overlay spinner", () => {
    render(<Button pending>保存</Button>);
    const button = screen.getByRole("button", { name: "保存" });
    expect(button.querySelector('[data-slot="button-content"]')).toHaveClass(
      "opacity-0",
    );
    expect(button.querySelector('[data-slot="button-pending"]')).toHaveClass(
      "absolute",
    );
  });
  it("uses the same dirty confirmation for footer cancellation", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Modal
        open
        title="编辑资料"
        dirty
        onClose={onClose}
        footer={<OverlayCancelButton />}
      >
        未保存的内容
      </Modal>,
    );
    const editor = screen.getByRole("dialog", { name: "编辑资料" });
    await user.click(within(editor).getByRole("button", { name: "取消" }));
    const confirmation = await screen.findByRole("dialog", {
      name: "放弃未保存的修改？",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "取消" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "放弃未保存的修改？" }),
    ).toBeNull();
    await user.click(within(editor).getByRole("button", { name: "取消" }));
    await user.click(await screen.findByRole("button", { name: "放弃修改" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("shows one submission error and clears the edited field error", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <SubmissionForm />
      </QueryClientProvider>,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    expect(input).toHaveAttribute("aria-required", "true");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(
      await screen.findByText("名称：请选择或输入有效值"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("保存失败")).toHaveLength(1);
    await user.type(input, "新名称");
    await waitFor(() =>
      expect(
        screen.queryByText("名称：请选择或输入有效值"),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByText("保存失败")).toHaveLength(1);
    client.clear();
  });
  it("supports roving tab focus and Home End navigation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function ControlledTabs() {
      const [value, setValue] = useState("one");
      return (
        <Tabs
          label="功能"
          value={value}
          onChange={(next) => {
            setValue(next);
            onChange(next);
          }}
          items={[
            { value: "one", label: "第一项" },
            { value: "two", label: "第二项" },
            { value: "three", label: "第三项" },
          ]}
        />
      );
    }
    render(<ControlledTabs />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    tabs[0]?.focus();
    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("three");
    expect(tabs[2]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("one");
    expect(tabs[0]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("two");
    expect(tabs[1]).toHaveFocus();
  });
});
