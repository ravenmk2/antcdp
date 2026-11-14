import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/button";
import {
  FieldRoot,
  FieldLabel,
  FieldDescription,
  Input,
} from "@/components/fields";
import { AsyncBoundary } from "@/components/feedback";
import {
  OverlayRoot,
  OverlayPopup,
  OverlayTitle,
  OverlayCancelButton,
} from "@/components/overlays";
import { Pagination } from "@/components/pagination";

function ComposedEditor() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  return (
    <>
      <Button onClick={() => setOpen(true)}>打开自定义编辑器</Button>
      <OverlayRoot
        open={open}
        dirty={Boolean(value)}
        onClose={() => setOpen(false)}
      >
        <OverlayPopup side="left" className="max-w-4xl" initialFocus={false}>
          <main>
            <OverlayTitle>自定义编辑器</OverlayTitle>
            <FieldRoot label="名称" hint="输入资源名称" className="flex">
              <Input
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
              <aside>
                <FieldLabel />
                <FieldDescription />
              </aside>
            </FieldRoot>
          </main>
          <OverlayCancelButton>离开编辑器</OverlayCancelButton>
        </OverlayPopup>
      </OverlayRoot>
    </>
  );
}

describe("component composition", () => {
  it("preserves field semantics and draft protection with a custom popup structure", async () => {
    const user = userEvent.setup();
    render(<ComposedEditor />);
    await user.click(screen.getByRole("button", { name: "打开自定义编辑器" }));
    const input = screen.getByRole("textbox", { name: "名称" });
    expect(input).toHaveAccessibleDescription("输入资源名称");
    await user.type(input, "草稿");
    await user.click(screen.getByRole("button", { name: "离开编辑器" }));
    expect(
      await screen.findByRole("dialog", { name: "放弃未保存的修改？" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue("草稿");
    await user.click(screen.getByRole("button", { name: "离开编辑器" }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("allows page-specific async states, including an intentionally empty fallback", () => {
    const view = render(
      <AsyncBoundary loading loadingFallback={<p role="status">列表占位</p>}>
        内容
      </AsyncBoundary>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("列表占位");
    view.rerender(
      <AsyncBoundary
        error={new Error("失败")}
        errorFallback={() => <button>局部重试</button>}
      >
        内容
      </AsyncBoundary>,
    );
    expect(screen.getByRole("button", { name: "局部重试" })).toBeVisible();
    view.rerender(
      <AsyncBoundary empty emptyFallback={null}>
        内容
      </AsyncBoundary>,
    );
    expect(view.container).toBeEmptyDOMElement();
  });

  it("exposes normalized pagination state without requiring the default controls", async () => {
    const user = userEvent.setup();
    function CustomPagination() {
      const [page, setPage] = useState(3);
      return (
        <Pagination page={page} size={10} total={21} onChange={setPage}>
          {({ current, first }) => (
            <button disabled={first} onClick={() => setPage(current - 1)}>
              上一批 {current}
            </button>
          )}
        </Pagination>
      );
    }
    render(<CustomPagination />);
    await user.click(screen.getByRole("button", { name: "上一批 3" }));
    expect(screen.getByRole("button", { name: "上一批 2" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "上一批 2" }));
    expect(screen.getByRole("button", { name: "上一批 1" })).toBeDisabled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
