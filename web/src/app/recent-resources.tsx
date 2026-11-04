import { useEffect, useState } from "react";
import { Link, useLocation, useMatches } from "react-router";
import { ArrowRight, Folder, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

type RecentResource = { to: string; name: string; kind: "projects" | "teams" };
const storageKey = (user: string) => "antcdp.recent-resources." + user;

export function readRecentResources(user: string): RecentResource[] {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(storageKey(user)) || "[]",
    );
    return Array.isArray(value)
      ? value
          .filter(
            (row): row is RecentResource =>
              !!row &&
              typeof row.name === "string" &&
              (row.kind === "projects" || row.kind === "teams") &&
              typeof row.to === "string" &&
              new RegExp(`^/${row.kind}/[1-9]\\d*$`).test(row.to),
          )
          .slice(0, 5)
          .map(({ to, name, kind }) => ({ to, name, kind }))
      : [];
  } catch {
    return [];
  }
}

export function RecentResourceTracker({ user }: { user: string }) {
  const { pathname } = useLocation();
  const matches = useMatches();
  const data = matches.at(-1)?.loaderData as
    { resource?: { name: string }; project?: { name: string } } | undefined;
  const name = data?.resource?.name || data?.project?.name;
  useEffect(() => {
    const match = /^\/(projects|teams)\/([1-9]\d*)(?:\/|$)/.exec(pathname);
    if (!match || !name) return;
    const kind = match[1] as RecentResource["kind"];
    const to = `/${kind}/${match[2]}`;
    const recent = [
      { to, name, kind },
      ...readRecentResources(user).filter((r) => r.to !== to),
    ].slice(0, 5);
    try {
      sessionStorage.setItem(storageKey(user), JSON.stringify(recent));
    } catch {
      // Recent visits are optional and stay in this browser tab.
    }
  }, [pathname, name, user]);
  return null;
}

export function RecentResources({ user }: { user: string }) {
  const [recent] = useState(() => readRecentResources(user));
  return (
    <section aria-labelledby="recent-resources-title" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="recent-resources-title" className="text-base font-semibold">
          继续工作
        </h2>
        <span className="text-xs text-muted-foreground">本次浏览器访问</span>
      </div>
      {recent.length ? (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {recent.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 px-5 py-4 hover:bg-muted/40"
            >
              {item.kind === "projects" ? (
                <Folder className="size-5 shrink-0 text-muted-foreground" />
              ) : (
                <Users className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <span className="block break-words font-medium">
                  {item.name}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {item.kind === "projects" ? "项目" : "团队"}
                </span>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border bg-card p-6 sm:p-8">
          <Folder className="mb-4 size-6 text-muted-foreground" />
          <h3 className="font-medium">从一个项目开始</h3>
          <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
            进入你参与的项目，查看仓库、环境与发布。访问过的项目和团队会出现在这里。
          </p>
          <Button asChild className="mt-5">
            <Link to="/projects">
              浏览我的项目
              <ArrowRight />
            </Link>
          </Button>
        </div>
      )}
    </section>
  );
}
