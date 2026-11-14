import { Shell as AccountShell } from "@/areas/account/shell/shell";
import { Shell as ConsoleShell } from "@/areas/console/shell/shell";
import { Shell as WorkspaceShell } from "@/areas/workspace/shell/shell";
import { useLocation } from "react-router";
export function AppShell() {
  const { pathname } = useLocation();
  return pathname.startsWith("/admin") ? (
    <ConsoleShell />
  ) : pathname.startsWith("/account") ? (
    <AccountShell />
  ) : (
    <WorkspaceShell />
  );
}
