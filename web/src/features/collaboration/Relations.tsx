import { Link } from "react-router";
import type { Kind, Resource } from "@/shared/collaboration";
import { useQuery } from "@/lib/use-query";
import { AsyncState } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { ResourceIcon } from "./ResourceIcon";
import type { Command } from "./ResourceCommand";
export function Relations({
  kind,
  resource,
  admin,
  onCommand,
}: {
  kind: Kind;
  resource: Resource;
  admin: boolean;
  onCommand: (c: Command) => void;
}) {
  const other = kind === "projects" ? "teams" : "projects",
    query = useQuery<Resource[]>(
      `/${kind}/${resource.id}/${other}`,
      resource.membership_etag,
    ),
    writable =
      kind === "projects" &&
      resource.can_manage &&
      resource.status === "active";
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {kind === "projects"
            ? "团队授权只授予成员权限，不能继承项目管理员角色。"
            : "展示当前团队已加入且你可以访问的项目。"}
        </p>
        {writable && (
          <Button onClick={() => onCommand({ action: "add-team" })}>
            添加团队
          </Button>
        )}
      </div>
      <AsyncState
        loading={query.loading}
        error={query.error}
        empty={!query.data?.length}
        onRetry={query.refresh}
      >
        <div className="divide-y">
          {query.data?.map((r) => (
            <div key={r.id} className="flex items-center gap-4 py-5">
              <ResourceIcon
                iconKey={r.icon_key}
                fileId={r.icon_file_id}
                team={other === "teams"}
                large
              />
              <div className="min-w-0 flex-1">
                <h3 className="font-medium">
                  {kind === "teams" && (admin || r.is_member) ? (
                    <Link
                      className="hover:underline"
                      to={`${admin ? "/admin" : ""}/projects/${r.id}`}
                    >
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{r.code}</p>
                <p className="mt-2 break-words text-sm text-muted-foreground">
                  {r.summary}
                </p>
              </div>
              {writable && (
                <Button
                  variant="ghost"
                  onClick={() => onCommand({ action: "remove-team", team: r })}
                >
                  移除授权
                </Button>
              )}
            </div>
          ))}
        </div>
      </AsyncState>
    </section>
  );
}
