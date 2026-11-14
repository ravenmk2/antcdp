import { Button } from "@/components/button";
import { LoadingState, Notice } from "@/components/feedback";
import { Component, Suspense, type ReactNode } from "react";

export function RegionError({ label }: { label: string }) {
  return (
    <main className="p-8">
      <Notice tone="danger" title={`${label}暂时无法显示`}>
        请重新加载页面；已提交的远端操作不会因此取消。
      </Notice>
      <Button className="mt-4" onClick={() => window.location.reload()}>
        重新加载
      </Button>
    </main>
  );
}

class RegionBoundary extends Component<
  { label: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <RegionError label={this.props.label} />
    ) : (
      this.props.children
    );
  }
}

export function RegionLoader({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <RegionBoundary label={label}>
      <Suspense
        fallback={
          <main className="p-8">
            <LoadingState label={`正在加载${label}…`} />
          </main>
        }
      >
        {children}
      </Suspense>
    </RegionBoundary>
  );
}
