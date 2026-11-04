import {
  ShieldCheck as ActionShieldCheck,
  UserMinus as ActionUserMinus,
} from "lucide-react";
import { useState } from "react";
import type { Kind, Resource, Member } from "@/shared/collaboration";
import { useQuery } from "@/lib/use-query";
import { AsyncState } from "@/components/platform/feedback";
import { Pagination } from "@/components/platform/pagination";
import { Avatar } from "@/components/platform/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import type { Command } from "./ResourceCommand";
export function Members({
  kind,
  resource,
  onCommand,
}: {
  kind: Kind;
  resource: Resource;
  onCommand: (c: Command) => void;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const query = useQuery<{
    items: Member[];
    total: number;
    membership_etag: string;
  }>(
    `/${kind}/${resource.id}/members?page=${page}&page_size=${size}&q=${encodeURIComponent(q)}`,
    resource.membership_etag,
  );
  const writable = resource.can_manage && resource.status === "active";
  return (
    <section className="space-y-5" aria-label="成员">
      <div className="flex flex-wrap gap-3">
        <form
          className="flex max-w-lg flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(String(new FormData(e.currentTarget).get("q") || ""));
            setPage(1);
          }}
        >
          <Input
            name="q"
            aria-label="搜索成员"
            placeholder="搜索成员名称或账号"
          />
          <Button variant="outline">搜索</Button>
        </form>
        {writable && (
          <Button
            disabled={query.loading || !query.data}
            onClick={() =>
              onCommand({
                action: "add-member",
                tag: query.data?.membership_etag,
              })
            }
          >
            添加成员
          </Button>
        )}
      </div>
      <AsyncState
        loading={query.loading}
        error={query.error}
        empty={!query.data?.items.length}
        onRetry={query.refresh}
      >
        <Table aria-label="成员列表">
          <TableHeader>
            <TableRow>
              <TableHead>成员</TableHead>
              <TableHead>权限来源</TableHead>
              <TableHead>有效角色</TableHead>
              {writable && <TableHead>操作</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data?.items.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar name={m.display_name} />
                    <div>
                      {m.display_name}
                      <div className="text-xs text-muted-foreground">
                        @{m.username}
                        {m.account_status !== "active" ? " · 已禁用" : ""}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {m.sources.slice(0, 2).map((source, i) => (
                      <span
                        className="rounded-md bg-muted px-2 py-1 text-xs"
                        key={i}
                      >
                        {source.type === "direct"
                          ? "直接加入"
                          : source.team_name}
                      </span>
                    ))}
                  </div>
                  {m.sources.length > 2 && (
                    <details className="mt-2 text-xs">
                      <summary>另有 {m.sources.length - 2} 个来源</summary>
                      {m.sources.slice(2).map((s, i) => (
                        <p key={i}>
                          {s.type === "direct" ? "直接加入" : s.team_name}
                        </p>
                      ))}
                    </details>
                  )}
                </TableCell>
                <TableCell>
                  {m.effective_role === "admin" ? "管理员" : "成员"}
                </TableCell>
                {writable && (
                  <TableCell>
                    {m.direct_role ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`管理${m.display_name}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() =>
                              onCommand({
                                action: "role",
                                member: m,
                                tag: query.data?.membership_etag,
                              })
                            }
                          >
                            <ActionShieldCheck />
                            调整角色
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() =>
                              onCommand({
                                action: "remove-member",
                                member: m,
                                tag: query.data?.membership_etag,
                              })
                            }
                          >
                            <ActionUserMinus />
                            移除直接身份
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        通过团队管理
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AsyncState>
      {query.data && (
        <Pagination
          page={page}
          size={size}
          total={query.data.total}
          pending={query.loading}
          onChange={(p, n) => {
            setPage(p);
            setSize(n);
          }}
        />
      )}
      {kind === "projects" && (
        <p className="text-xs text-muted-foreground">
          团队成员继承项目访问权，项目管理员角色由项目直接授予。
        </p>
      )}
    </section>
  );
}
