import { afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "@/components/platform/pagination";
afterEach(cleanup);
it("shows the confirmed total and resets to page one on a size change", async () => {
  const change = vi.fn();
  render(<Pagination page={2} size={10} total={94} onChange={change} />);
  expect(screen.getByText("共 94 条")).toBeTruthy();
  expect(screen.getByText("2/10")).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText("每页条数"), "20");
  expect(change).toHaveBeenCalledWith(1, 20);
});
it("reports only the actual page count and uses the server cursor for next", () => {
  render(
    <Pagination
      page={4}
      size={20}
      pageItems={3}
      hasNext={false}
      onChange={vi.fn()}
    />,
  );
  expect(screen.getByText("本页 3 条")).toBeTruthy();
  expect(screen.queryByText(/^共 |\d\/\d/)).toBeNull();
  expect((screen.getByLabelText("下一页") as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect((screen.getByLabelText("上一页") as HTMLButtonElement).disabled).toBe(
    false,
  );
});
