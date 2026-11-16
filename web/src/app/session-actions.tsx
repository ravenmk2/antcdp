import { api, resetCSRF } from "@/api/client";
import { IconButton } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { ConfirmDialog } from "@/components/overlays";
import { useSubmission } from "@/hooks/use-form";
import { useQueryClient } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { useState } from "react";
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
export function ShellActions() {
  const { resolved, setAppearance } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <IconButton
      label={`切换为${appearanceLabels[next]}主题`}
      title={`切换为${appearanceLabels[next]}主题`}
      onClick={() => setAppearance(next)}
    >
      {resolved === "dark" ? <Moon /> : <Sun />}
    </IconButton>
  );
}
