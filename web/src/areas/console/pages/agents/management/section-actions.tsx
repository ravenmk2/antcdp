import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Button } from "@/components/button";
export function ConfigActions({
  dirty,
  pending,
  blocked,
  children,
  showExit = true,
}: {
  dirty: boolean;
  pending: boolean;
  blocked: boolean;
  children: ReactNode;
  showExit?: boolean;
}) {
  const [params] = useSearchParams();
  return (
    <div className="agent-config-actions">
      <span className="text-xs text-muted" role="status">
        {blocked
          ? "请先核实保存结果"
          : pending
            ? "正在保存…"
            : dirty
              ? "有未保存的修改"
              : "当前配置已保存"}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {showExit && (
          <Button
            variant="ghost"
            role="link"
            nativeButton={false}
            disabled={pending}
            render={
              pending ? (
                <span />
              ) : (
                <Link to={`?tab=${params.get("tab") ?? "basic"}`} />
              )
            }
          >
            退出编辑
          </Button>
        )}
      </div>
    </div>
  );
}
