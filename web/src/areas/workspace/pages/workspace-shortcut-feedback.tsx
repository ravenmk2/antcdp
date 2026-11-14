import { Button } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";

export function WorkspaceShortcutFeedback({
  error,
  pending,
  onReload,
}: {
  error: unknown;
  pending: boolean;
  onReload: () => void;
}) {
  return (
    <div className="workspace-detail-shortcut-feedback">
      <ErrorNotice error={error} />
      <Button variant="outline" size="sm" pending={pending} onClick={onReload}>
        重新读取快捷方式
      </Button>
    </div>
  );
}
