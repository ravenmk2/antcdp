import { api, resetCSRF } from "@/api/client";
import { IconButton } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { ConfirmDialog } from "@/components/overlays";
import { MenuLink } from "@/components/platform/menu-link";
import { DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { useSubmission } from "@/hooks/use-form";
import { useQueryClient } from "@tanstack/react-query";
import { Folder, Monitor, Moon, Plus, Rocket, Sun, Users } from "lucide-react";
import { Menu as DropdownMenu } from "@base-ui/react/menu";
import { useState } from "react";
import { useSession } from "./auth";
import { appearanceLabels, useTheme } from "./theme";
export function useLogout() {
  const [visible, setVisible] = useState(false);
  const submission = useSubmission();
  const queryClient = useQueryClient();
  return {
    visible,
    submission,
    open: () => setVisible(true),
    close: () => setVisible(false),
    confirm: async () => {
      const ok = await submission.run(async () => {
        await api("/auth/logout", {});
        resetCSRF();
        queryClient.clear();
        window.location.replace("/login");
      });
      if (!ok) setVisible(true);
    },
  };
}
export function LogoutDialog({
  controller: c,
}: {
  controller: ReturnType<typeof useLogout>;
}) {
  return (
    <ConfirmDialog
      open={c.visible}
      title="确认退出登录"
      description="退出后需要重新登录；未保存的修改不会保留。"
      confirmLabel="退出登录"
      pending={c.submission.pending}
      onClose={c.close}
      onConfirm={() => void c.confirm()}
    >
      <ErrorNotice error={c.submission.error} />
    </ConfirmDialog>
  );
}
export function ShellActions({ projectId }: { projectId?: string }) {
  const session = useSession();
  const { appearance, cycle, resolved } = useTheme();
  return (
    <>
      {" "}
      {(session.user.role === "admin" || projectId) && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            render={
              <IconButton label="快速创建">
                <Plus />
              </IconButton>
            }
          />

          <DropdownMenuContent align="end" className="min-w-48">
            {session.user.role === "admin" && (
              <>
                <MenuLink
                  to="/admin/projects?create=1"
                  icon={Folder}
                  label="创建项目"
                />
                <MenuLink
                  to="/admin/teams?create=1"
                  icon={Users}
                  label="创建团队"
                />
              </>
            )}
            {projectId && (
              <MenuLink
                to={`/projects/${projectId}?tab=releases&create=1`}
                icon={Rocket}
                label="创建发布"
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu.Root>
      )}
      <IconButton
        label={`外观：${appearanceLabels[appearance]}，点击切换`}
        title={`外观：${appearanceLabels[appearance]}`}
        onClick={cycle}
      >
        {resolved === "dark" ? (
          <Moon />
        ) : appearance === "system" ? (
          <Monitor />
        ) : (
          <Sun />
        )}
      </IconButton>
    </>
  );
}
