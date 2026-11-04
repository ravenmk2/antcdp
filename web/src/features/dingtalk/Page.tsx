import { useOperationToast } from "@/components/platform/operation-toast";
import { OperationStatus } from "@/components/platform/operation-status";
import { EnabledStatus } from "@/components/platform/status-text";
import { useState } from "react";
import {
  Link,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import { Bot, Plus, MoreHorizontal, Trash2, Power } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Robot, labels } from "@/shared/dingtalk";
import { adminLoader } from "@/lib/loaders";
import { request, errorMessage } from "@/lib/api";
import { appHref } from "@/lib/navigation";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { useSubmission } from "@/components/platform/use-submission";
import { FormDialog } from "@/components/platform/form-dialog";
import { ValuesGrid } from "@/components/platform/form-controls";
import { NativeSelect } from "@/components/platform/native-select";
import { Pagination } from "@/components/platform/pagination";
import {
  RefreshButton,
  ErrorBox,
  EmptyState,
} from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
} from "@/components/ui/table";
import { Editor, base } from "./Editor";
import { TestRobot, Result } from "./TestRobot";
const path = "/admin/dingtalk";
export async function loader(args: LoaderFunctionArgs) {
  await adminLoader(args);
  const id = args.params.id,
    params = new URL(args.request.url).searchParams,
    opts = { signal: args.request.signal };
  if (id && !/^[1-9]\d*$/.test(id))
    throw new Response("机器人不存在", { status: 404 });
  const q = params.get("q") || "",
    status = params.get("status") || "",
    page = Math.max(1, Math.floor(Number(params.get("page")) || 1)),
    size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
      ? Number(params.get("page_size"))
      : 20;
  let robot: Robot | undefined,
    etag = "",
    items: Robot[] = [],
    total = 0;
  if (id) {
    const r = await request<Robot>(base + "/" + id, opts);
    robot = r.data;
    etag = r.etag;
  } else {
    const r = await request<{ items: Robot[]; total: number }>(
      base +
        "?" +
        new URLSearchParams({
          q,
          status,
          page: String(page),
          page_size: String(size),
        }),
      opts,
    );
    items = r.data.items;
    total = r.data.total;
  }
  return { robot, etag, items, total, q, status, page, size };
}
export function Component() {
  const data = useLoaderData<typeof loader>();
  return <Content key={data.robot?.id || "list"} data={data} />;
}
function Content({ data }: { data: Awaited<ReturnType<typeof loader>> }) {
  const [params, setParams] = useSearchParams(),
    r = useRevalidator(),
    after = useNavigateAfterSave();
  const [edit, setEdit] = useState<"create" | "edit" | "auth">(),
    [test, setTest] = useState<Robot>(),
    [cmd, setCmd] = useState<"delete" | "toggle">(),
    notify = useOperationToast();
  const robot = data.robot;
  function filter(values: Record<string, string>) {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete("page");
      for (const [k, v] of Object.entries(values)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      return p;
    });
  }
  function updated(text: string) {
    setEdit(undefined);
    setCmd(undefined);
    notify(text);
    void r.revalidate();
  }
  return (
    <section className="space-y-5">
      <div
        className={
          robot
            ? "flex flex-wrap items-center justify-between gap-3"
            : "sr-only"
        }
      >
        <h1
          className={robot ? "break-words text-2xl font-semibold" : "sr-only"}
        >
          {robot?.name || "钉钉机器人"}
        </h1>
        {robot && (
          <div className="flex items-center gap-2">
            <Button disabled={!robot.enabled} onClick={() => setTest(robot)}>
              发送测试
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="机器人更多操作">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setCmd("toggle")}>
                  <Power />
                  {robot.enabled ? "停用机器人" : "启用机器人"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setCmd("delete")}
                >
                  <Trash2 />
                  删除机器人
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {robot ? (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="space-y-5 rounded-xl border bg-card p-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 font-semibold">
                <Bot className="size-5" />
                机器人配置
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEdit("edit")}
              >
                编辑配置
              </Button>
            </header>
            <ValuesGrid
              items={[
                ["标识", robot.code],
                ["状态", <EnabledStatus enabled={robot.enabled} />],
                ["关键词", robot.keyword],
                ["说明", robot.description || "—"],
              ]}
            />
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEdit("auth")}
              >
                替换认证
              </Button>
            </div>
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-5">
            <h2 className="font-semibold">最近一次测试</h2>
            {robot.latest ? (
              <Result record={robot.latest} />
            ) : (
              <p className="text-sm text-muted-foreground">尚无测试记录。</p>
            )}
          </section>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="list-toolbar">
            <form
              className="flex min-w-48 flex-1 gap-2 sm:max-w-md"
              onSubmit={(e) => {
                e.preventDefault();
                filter({
                  q: String(new FormData(e.currentTarget).get("q") || ""),
                });
              }}
            >
              <Input
                name="q"
                key={data.q}
                defaultValue={data.q}
                aria-label="搜索机器人"
                placeholder="搜索名称或标识"
              />
              <Button variant="outline">搜索</Button>
            </form>
            <NativeSelect
              className="w-auto"
              aria-label="状态筛选"
              value={data.status}
              onChange={(e) => filter({ status: e.target.value })}
            >
              <option value="">全部状态</option>
              <option value="enabled">已启用</option>
              <option value="disabled">已停用</option>
            </NativeSelect>
            <RefreshButton
              loading={r.state !== "idle"}
              onClick={() => void r.revalidate()}
            />

            <Button className="sm:ml-auto" onClick={() => setEdit("create")}>
              <Plus />
              添加机器人
            </Button>
          </div>
          <Table aria-label="机器人列表">
            <TableHeader>
              <TableRow>
                {["机器人", "关键词", "状态", "最近诊断", "操作"].map((t) => (
                  <TableHead key={t}>{t}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((v) => (
                <TableRow key={v.id}>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      to={path + "/" + v.id + "?" + params}
                    >
                      {v.name}
                    </Link>
                    <small className="block text-muted-foreground">
                      {v.code}
                    </small>
                  </TableCell>
                  <TableCell>{v.keyword}</TableCell>
                  <TableCell>
                    <EnabledStatus enabled={v.enabled} />
                  </TableCell>
                  <TableCell>
                    {v.latest ? (
                      <OperationStatus
                        value={v.latest.outdated ? "outdated" : v.latest.status}
                      >
                        {v.latest.outdated && "历史 · "}
                        {labels[v.latest.status] || v.latest.status}
                      </OperationStatus>
                    ) : (
                      "尚无记录"
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        to={path + "/" + v.id + "?" + params}
                        className="hover:underline"
                      >
                        查看
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!v.enabled}
                        onClick={() => setTest(v)}
                      >
                        测试
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!data.items.length && (
            <EmptyState
              title={
                data.q || data.status ? "没有匹配的机器人" : "还没有钉钉机器人"
              }
              description={
                data.q || data.status
                  ? "调整搜索条件，或清除筛选查看全部机器人。"
                  : "添加群机器人的认证信息，再发送一次测试确认配置。"
              }
              action={
                data.q || data.status ? (
                  <Button
                    variant="outline"
                    onClick={() => filter({ q: "", status: "" })}
                  >
                    清除筛选
                  </Button>
                ) : (
                  <Button onClick={() => setEdit("create")}>添加机器人</Button>
                )
              }
            />
          )}
          <Pagination
            page={data.page}
            size={data.size}
            total={data.total}
            pending={r.state !== "idle"}
            onChange={(p, s) =>
              filter({ page: String(p), page_size: String(s) })
            }
          />
        </div>
      )}
      {edit && (
        <Editor
          authOnly={edit === "auth"}
          robot={robot}
          tag={data.etag}
          onClose={() => setEdit(undefined)}
          onSaved={(id) => {
            if (edit === "create") after(appHref(path + "/" + id));
            else updated("机器人配置已保存。");
          }}
        />
      )}
      {test && (
        <TestRobot
          robot={test}
          onClose={() => setTest(undefined)}
          onDone={() => void r.revalidate()}
        />
      )}
      {cmd && robot && (
        <Command
          action={cmd}
          robot={robot}
          tag={data.etag}
          onClose={() => setCmd(undefined)}
          onSaved={() => {
            if (cmd === "delete") after(appHref(path));
            else updated("机器人状态已更新。");
          }}
        />
      )}
    </section>
  );
}
function Command({
  action,
  robot,
  tag,
  onClose,
  onSaved,
}: {
  action: "delete" | "toggle";
  robot: Robot;
  tag: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [snapshot] = useState({ enabled: robot.enabled, tag }),
    save = useSubmission(),
    [error, setError] = useState(""),
    remove = action === "delete";
  return (
    <FormDialog
      compact
      open
      title={
        remove ? "删除机器人" : snapshot.enabled ? "停用机器人" : "启用机器人"
      }
      description={robot.name}
      pending={save.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={save.pending} onClick={onClose}>
            取消
          </Button>
          <Button
            variant={remove ? "destructive" : "default"}
            disabled={save.pending || save.blocked}
            onClick={() =>
              void save.submit(
                async () => {
                  await request(base + "/" + robot.id, {
                    method: remove ? "DELETE" : "PATCH",
                    etag: snapshot.tag,
                    body: remove ? undefined : { enabled: !snapshot.enabled },
                  });
                  onSaved();
                },
                (e) => setError(errorMessage(e)),
              )
            }
          >
            确认
          </Button>
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      <p>
        {remove
          ? "本地保存的机器人配置及认证材料将移除。"
          : "新状态会影响后续测试消息的发送。"}
      </p>
    </FormDialog>
  );
}
