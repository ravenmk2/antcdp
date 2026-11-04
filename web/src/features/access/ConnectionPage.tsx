import { Button } from "@/components/ui/button";
import { PublicFrame } from "./PublicFrame";
import { appHref, safeReturnTo } from "@/lib/navigation";
export function Component() {
  const url = new URL(location.href),
    next =
      safeReturnTo(url.searchParams.get("retry"), url.origin) ||
      appHref("/home");
  return (
    <PublicFrame
      title="暂时无法连接服务"
      intro="检查网络后重新连接，系统会再次核对会话并打开刚才的页面。"
    >
      <Button asChild>
        <a href={next}>重新连接</a>
      </Button>
    </PublicFrame>
  );
}
