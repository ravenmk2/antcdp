import { useOperationToast } from "@/components/platform/operation-toast";
import { LogOut, Pencil, Trash2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import {
  Link,
  redirect,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { type Kind, type Resource, statusLabel } from "@/shared/collaboration";
import { identityLoader, adminLoader } from "@/lib/loaders";
import { request } from "@/lib/api";
import { appHref } from "@/lib/navigation";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { RefreshButton } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Relations } from "./Relations";
import { ProjectDetail } from "./ProjectDetail";
import { ResourceIcon } from "./ResourceIcon";
import { ResourceEditor } from "./ResourceEditor";
import { ResourceCommand, type Command } from "./ResourceCommand";
import { Members } from "./Members";
import { Markdown } from "./Markdown";
import { PinButton, useShortcuts } from "./Shortcuts";

export async function loader(args: LoaderFunctionArgs) {
  const url = new URL(args.request.url),
    kind: Kind = url.pathname.includes("/teams/") ? "teams" : "projects",
    admin = url.pathname.includes("/admin/"),
    id = args.params.id;
  await (admin ? adminLoader(args) : identityLoader(args));
  if (!id || !/^\d+$/.test(id))
    throw new Response("对象不存在", { status: 404 });
  const resource = (
    await request<Resource>(`/${kind}/${id}`, { signal: args.request.signal })
  ).data;
  if (!admin && !resource.is_member)
    throw new Response("对象不存在", { status: 404 });
  const base = `${admin ? "/admin" : ""}/${kind}`;
  if (kind === "projects" && url.searchParams.get("tab") === "variants") {
    const query = new URLSearchParams(url.search);
    query.delete("tab");
    for (const [from, to] of [
      ["vq", "q"],
      ["vpage", "page"],
      ["vsize", "page_size"],
      ["vstatus", "status"],
    ])
      if (query.has(from!)) {
        query.set(to!, query.get(from!)!);
        query.delete(from!);
      }
    throw redirect(`${base}/${id}/variants?${query}`);
  }
  return { resource, kind, admin, base };
}
export function Component() {
  const data = useLoaderData<typeof loader>();
  return data.kind === "projects" ? (
    <ProjectDetail
      key={data.resource.id}
      project={data.resource}
      admin={data.admin}
    />
  ) : (
    <TeamDetail
      key={data.resource.id}
      resource={data.resource}
      admin={data.admin}
      base={data.base}
    />
  );
}

function TeamDetail({
  resource,
  admin,
  base,
}: {
  resource: Resource;
  admin: boolean;
  base: string;
}) {
  const [params] = useSearchParams(),
    revalidator = useRevalidator(),
    shortcuts = useShortcuts(),
    afterSave = useNavigateAfterSave();
  const [editor, setEditor] = useState(false),
    [command, setCommand] = useState<Command>(),
    notify = useOperationToast();
  const sections = [
    ["overview", "概览"],
    ["members", `成员 · ${resource.member_count}`],
    ["projects", "加入项目"],
  ] as const;
  const tab =
    sections.find(([key]) => key === params.get("tab"))?.[0] ?? "overview";
  const writable = resource.can_manage && resource.status === "active";
  function saved() {
    setEditor(false);
    setCommand(undefined);
    notify("操作已完成。");
    shortcuts.refresh();
    void revalidator.revalidate();
  }
  return (
    <section className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <ResourceIcon
            iconKey={resource.icon_key}
            fileId={resource.icon_file_id}
            team
            large
          />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-semibold">
              {resource.name}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="break-all">{resource.code}</span>
              <span>· {statusLabel(resource.status)}</span>
            </div>
            {resource.summary && (
              <p className="mt-3 max-w-3xl break-words text-sm text-muted-foreground">
                {resource.summary}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PinButton kind="teams" resource={resource} />
          <RefreshButton
            loading={revalidator.state !== "idle"}
            onClick={() => void revalidator.revalidate()}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="更多操作">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {writable && (
                <DropdownMenuItem onSelect={() => setEditor(true)}>
                  <Pencil />
                  编辑资料
                </DropdownMenuItem>
              )}
              {resource.direct_role && (
                <DropdownMenuItem
                  onSelect={() => setCommand({ action: "leave" })}
                >
                  <LogOut />
                  退出团队
                </DropdownMenuItem>
              )}
              {admin && resource.status === "active" && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setCommand({ action: "dissolve" })}
                  >
                    <Trash2 />
                    解散团队
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {resource.status !== "active" && (
        <p className="rounded-lg bg-muted p-4 text-sm">
          团队{statusLabel(resource.status)}，资料与关系只读。
        </p>
      )}
      <nav className="flex flex-wrap gap-2 border-b pb-3" aria-label="详情导航">
        {sections.map(([key, text]) => (
          <Link
            key={key}
            to={`?tab=${key}`}
            aria-current={tab === key ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm ${tab === key ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}
          >
            {text}
          </Link>
        ))}
      </nav>
      {tab === "members" ? (
        <Members kind="teams" resource={resource} onCommand={setCommand} />
      ) : tab === "projects" ? (
        <Relations
          kind="teams"
          resource={resource}
          admin={admin}
          onCommand={setCommand}
        />
      ) : (
        <section className="max-w-4xl space-y-6">
          <dl className="grid gap-5 rounded-xl border bg-card p-5 text-sm sm:grid-cols-3">
            <div>
              <dt className="mb-2 text-muted-foreground">我的成员身份</dt>
              <dd>
                {resource.direct_role === "admin"
                  ? "管理员"
                  : resource.is_member
                    ? "成员"
                    : "未加入"}
              </dd>
            </div>
            <div>
              <dt className="mb-2 text-muted-foreground">成员人数</dt>
              <dd>{resource.member_count}</dd>
            </div>
            <div>
              <dt className="mb-2 text-muted-foreground">管理权限</dt>
              <dd>{writable ? "可管理" : "只读"}</dd>
            </div>
          </dl>
          <h2 className="font-medium">简介</h2>
          <Markdown text={resource.description || "尚未填写简介。"} />
        </section>
      )}
      {editor && (
        <ResourceEditor
          kind="teams"
          resource={resource}
          onClose={() => setEditor(false)}
          onSaved={saved}
        />
      )}
      {command && (
        <ResourceCommand
          key={resource.id + command.action}
          kind="teams"
          resource={resource}
          command={command}
          consoleMode={admin}
          onClose={() => setCommand(undefined)}
          onSaved={() => {
            if (command.action === "leave") afterSave(appHref(base));
            else saved();
          }}
        />
      )}
    </section>
  );
}
