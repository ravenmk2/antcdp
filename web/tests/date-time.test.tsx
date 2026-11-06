import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  dayBoundary,
  parseZonedInput,
  presetRange,
  zonedInput,
  validateRange,
} from "@/lib/date-time";
import { DateRangePicker, DateTimePicker } from "@/components/date-time-picker";
import { Field, Select, StandaloneInput } from "@/components/fields";
import { TableToolbar } from "@/components/table-toolbar";
import { useFormErrors } from "@/hooks/use-form";

describe("system timezone dates", () => {
  it("round trips wall time without depending on the browser timezone", () => {
    expect(parseZonedInput("2026-11-06 09:30", "Asia/Shanghai")).toBe(
      "2026-11-06T01:30:00.000Z",
    );
    expect(zonedInput("2026-11-06T01:30:00Z", "Asia/Shanghai")).toBe(
      "2026-11-06 09:30",
    );
    expect(parseZonedInput("2026-11-06 09:30", "America/New_York")).toBe(
      "2026-11-06T14:30:00.000Z",
    );
  });
  it("rejects impossible dates, reversed ranges and nonexistent DST times", () => {
    expect(() => parseZonedInput("2026-02-30 12:00", "UTC")).toThrow();
    expect(() =>
      parseZonedInput("2026-03-08 02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      validateRange({
        from: "2026-11-06T10:00:00Z",
        to: "2026-11-06T09:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      validateRange(
        { from: "", to: "2026-01-01T00:00:00Z" },
        30,
        Date.parse("2026-11-06"),
      ),
    ).toThrow();
  });
  it("uses the next calendar midnight for full days including DST days", () => {
    const now = new Date("2026-03-08T16:00:00Z");
    const today = presetRange("today", "America/New_York", now);
    expect(today.from).toBe("2026-03-08T05:00:00.000Z");
    expect(today.to).toBe("2026-03-09T04:00:00.000Z");
    expect(dayBoundary(now, "America/New_York", 1)).toBe(today.to);
    expect(presetRange("1", "America/New_York", now).from).toBe(
      "2026-03-07T16:00:00.000Z",
    );
  });
});

describe("filter controls", () => {
  it("keeps date drafts private until apply, validates and restores focus", async () => {
    const user = userEvent.setup(),
      apply = vi.fn();
    render(
      <DateRangePicker
        timezone="Asia/Shanghai"
        value={{ from: "", to: "" }}
        onApply={apply}
      />,
    );
    const trigger = screen.getByRole("button", { name: "时间范围" });
    await user.click(trigger);
    await user.type(screen.getByLabelText("开始时间"), "2026-11-06 10:30");
    await user.type(screen.getByLabelText("结束时间"), "2026-11-06 09:30");
    await user.click(screen.getByRole("button", { name: "应用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "结束时间必须晚于开始时间",
    );
    expect(apply).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("结束时间"));
    await user.click(screen.getByRole("button", { name: "应用" }));
    expect(apply).toHaveBeenCalledWith({
      from: "2026-11-06T02:30:00.000Z",
      to: "",
      preset: "custom",
    });
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "近 7 天" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it("keeps credential dates as UTC, supports cancel and clear", async () => {
    const user = userEvent.setup(),
      change = vi.fn();
    render(
      <Field label="到期时间">
        <DateTimePicker
          name="expires_at"
          timezone="Asia/Shanghai"
          value="2026-11-06T01:00:00Z"
          onChange={change}
        />
      </Field>,
    );
    await user.click(screen.getByLabelText("到期时间"));
    expect(screen.getByLabelText("到期日期与时间")).toHaveValue(
      "2026-11-06 09:00",
    );
    await user.clear(screen.getByLabelText("到期日期与时间"));
    await user.type(
      screen.getByLabelText("到期日期与时间"),
      "2026-11-07 18:30",
    );
    await user.click(screen.getByRole("button", { name: "确定" }));
    expect(change).toHaveBeenCalledWith("2026-11-07T10:30:00.000Z");
    await user.click(screen.getByLabelText("到期时间"));
    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(change).toHaveBeenLastCalledWith("");
  });
  it("submits empty choices accurately and focuses visible triggers on validation", async () => {
    const submit = vi.fn(),
      user = userEvent.setup();
    function Form() {
      const [value, setValue] = useState("");
      const errors = useFormErrors();
      return (
        <form
          ref={errors.formRef}
          onSubmit={(e) => {
            e.preventDefault();
            submit(new FormData(e.currentTarget).get("status"));
          }}
        >
          <Field label="状态" error={errors.fields.status}>
            <Select name="status" value={value} onValueChange={setValue}>
              <option value="">全部状态</option>
              <option value="active">正常</option>
              <option value="disabled" disabled>
                不可选
              </option>
            </Select>
          </Field>
          <button type="submit">提交</button>
          <button
            type="button"
            onClick={() => errors.validate({ status: "请选择状态" })}
          >
            校验
          </button>
        </form>
      );
    }
    render(<Form />);
    await user.click(screen.getByRole("button", { name: "提交" }));
    expect(submit).toHaveBeenLastCalledWith("");
    await user.click(screen.getByRole("combobox", { name: "状态" }));
    expect(screen.getByRole("option", { name: "不可选" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.click(screen.getByRole("option", { name: "正常" }));
    await user.click(screen.getByRole("button", { name: "提交" }));
    expect(submit).toHaveBeenLastCalledWith("active");
    await user.click(screen.getByRole("button", { name: "校验" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "状态" })).toHaveFocus(),
    );
  });
  it("resets unsubmitted search text and preserves collapsed advanced conditions", async () => {
    const user = userEvent.setup();
    function Toolbar() {
      const [filter, setFilter] = useState("42");
      return (
        <TableToolbar
          onReset={() => setFilter("")}
          advancedCount={filter ? 1 : 0}
          advanced={
            <StandaloneInput
              aria-label="配置 ID"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          }
        >
          <StandaloneInput aria-label="关键词" defaultValue="" />
        </TableToolbar>
      );
    }
    render(<Toolbar />);
    await user.type(screen.getByLabelText("关键词"), "未提交");
    await user.click(screen.getByRole("button", { name: /高级搜索/ }));
    expect(screen.getByLabelText("配置 ID")).toHaveValue("42");
    await user.click(screen.getByRole("button", { name: /高级搜索/ }));
    await user.click(screen.getByRole("button", { name: /高级搜索/ }));
    expect(screen.getByLabelText("配置 ID")).toHaveValue("42");
    await user.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.getByLabelText("关键词")).toHaveValue("");
    expect(screen.getByLabelText("配置 ID")).toHaveValue("");
  });
});
