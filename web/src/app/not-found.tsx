import { Link } from "react-router";
import { Button } from "@/components/button";
import { EmptyState } from "@/components/feedback";

export function NotFound() {
  return (
    <div className="page">
      <EmptyState
        title="页面或资源不存在"
        description="请检查访问地址，或从导航重新进入。"
        action={
          <Button asChild variant="outline">
            <Link to="/home">返回工作区</Link>
          </Button>
        }
      />
    </div>
  );
}
