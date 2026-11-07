import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import {
  EmailParameterSchema,
  EmailParameterValues,
} from "@/features/email/email-parameters";
const schema = {
  code: { type: "string", required: true },
  count: { type: "number", required: false, default: 2 },
  active: { type: "boolean", required: false },
  items: {
    type: "array",
    required: false,
    items: {
      type: "object",
      properties: { name: { type: "string", required: true } },
    },
  },
};
function Harness({ definition = false }: { definition?: boolean }) {
  const [value, setValue] = useState(
    JSON.stringify(
      definition
        ? schema
        : { code: "0012", count: 3, active: false, items: [{ name: "示例" }] },
    ),
  );
  return (
    <>
      {definition ? (
        <EmailParameterSchema value={value} onChange={setValue} />
      ) : (
        <EmailParameterValues
          schema={JSON.stringify(schema)}
          value={value}
          onChange={setValue}
        />
      )}
      <output data-testid="value">{value}</output>
    </>
  );
}
it("keeps nested array definitions and defaults when editing a scalar parameter", async () => {
  render(<Harness definition />);
  const user = userEvent.setup();
  await user.type(
    screen.getAllByRole("textbox", { name: "参数说明" })[0],
    "验证码",
  );
  const result = JSON.parse(screen.getByTestId("value").textContent!);
  expect(result.code.description).toBe("验证码");
  expect(result.items.items.properties.name).toEqual(
    schema.items.items.properties.name,
  );
  expect(result.count.default).toBe(2);
  await user.click(screen.getByRole("button", { name: "高级 JSON" }));
  expect(
    screen.getByRole("textbox", { name: "参数 Schema（JSON）" }),
  ).toHaveValue(JSON.stringify(result, null, 2));
  await user.click(screen.getByRole("button", { name: "表单编辑" }));
  expect(screen.getAllByRole("textbox", { name: "参数说明" })[0]).toHaveValue(
    "验证码",
  );
});
it("preserves string zeros and typed samples through incomplete numeric edits", async () => {
  render(<Harness />);
  const user = userEvent.setup();
  const count = screen.getByRole("textbox", { name: "count" });
  await user.clear(count);
  expect(
    Array.isArray(JSON.parse(screen.getByTestId("value").textContent!)),
  ).toBe(true);
  await user.type(count, "12.5");
  const result = JSON.parse(screen.getByTestId("value").textContent!);
  expect(result).toEqual({
    code: "0012",
    count: 12.5,
    active: false,
    items: [{ name: "示例" }],
  });
  await user.click(screen.getByRole("button", { name: "高级 JSON" }));
  await user.click(screen.getByRole("button", { name: "表单输入" }));
  expect(screen.getByRole("textbox", { name: "code" })).toHaveValue("0012");
});
it("blocks duplicate names without dropping the unfinished parameter", async () => {
  render(<Harness definition />);
  const user = userEvent.setup();
  await user.click(
    within(screen.getByRole("region", { name: "参数定义" }))
      .getAllByRole("button", { name: "添加参数" })
      .at(-1)!,
  );
  const names = screen.getAllByRole("textbox", { name: "参数名称" });
  await user.type(names.at(-1)!, "code");
  expect(screen.getByRole("alert")).toHaveTextContent("同级名称不能重复");
  expect(
    Array.isArray(JSON.parse(screen.getByTestId("value").textContent!)),
  ).toBe(true);
});
