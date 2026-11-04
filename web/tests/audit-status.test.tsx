import { render, screen, cleanup } from "@testing-library/react";
import { it, expect, afterEach } from "vitest";
import { AuditStatus } from "@/features/admin/AuditStatus";
import type { AuditEvent } from "@/shared/audit";
afterEach(cleanup);
it.each([
  ["email.profile.test_completed", {}, "已记录"],
  ["email.profile.test_started", {}, "已开始"],
  ["auth.login_succeeded", {}, "成功"],
  ["project_branch_creation.item_finished", { status: "failed" }, "失败"],
  [
    "project_branch_creation.item_finished",
    { status: "unrecognized" },
    "已记录",
  ],
  ["user.created", { status: "failed" }, "已记录"],
])("displays the recorded outcome for %s", (action, detail, label) => {
  render(<AuditStatus event={{ action, detail } as AuditEvent} />);
  expect(screen.getByText(String(label))).toBeTruthy();
});
