import { OperationStatus } from "@/components/platform/operation-status";
import { EnabledStatus } from "@/components/platform/status-text";
import { useMemo, useState, useEffect } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useSearchParams,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import {
  MessageSquare,
  ChevronDown,
  SlidersHorizontal,
  Plus,
  MoreHorizontal,
  Trash2,
  Power,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type Profile,
  type Template,
  type Log,
  type Page,
  labels,
  explain,
} from "@/shared/sms";
import { adminLoader } from "@/lib/loaders";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { appHref } from "@/lib/navigation";
import { useSubmission } from "@/components/platform/use-submission";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { ValuesGrid } from "@/components/platform/form-controls";
import {
  AsyncState,
  EmptyState,
  ErrorBox,
  RefreshButton,
} from "@/components/platform/feedback";
import { FormDrawer } from "@/components/platform/form-drawer";
import { FormDialog } from "@/components/platform/form-dialog";
import { NativeSelect } from "@/components/platform/native-select";
import { Pagination } from "@/components/platform/pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { ProfileEditor } from "./ProfileEditor";
import { TemplateEditor } from "./TemplateEditor";
import { SendTest, LogValues, Simulation } from "./Testing";
const base = "/admin/sms";
const sections = {
  profiles: "短信配置",
  templates: "短信模板",
  "send-logs": "发送日志",
} as const;
type Section = keyof typeof sections;
export async function loader(args: LoaderFunctionArgs) {
  await adminLoader(args);
  const section = (args.params.section || "profiles") as Section,
    id = args.params.id;
  if (
    !Object.hasOwn(sections, section) ||
    (id && !/^[1-9]\d*$/.test(id) && !(id === "new" && section === "templates"))
  )
    throw new Response("页面不存在", { status: 404 });
  let profile: Profile | undefined,
    template: Template | undefined,
    log: Log | undefined,
    tag = "";
  if (id && id !== "new") {
    const url = base + "/" + section + "/" + id,
      opts = { signal: args.request.signal };
    if (section === "profiles") {
      const r = await request<Profile>(url, opts);
      profile = r.data;
      tag = r.etag;
    } else if (section === "templates") {
      const r = await request<Template>(url, opts);
      template = r.data;
      tag = r.etag;
    } else log = (await request<Log>(url, opts)).data;
  }
  return { section, id, profile, template, log, tag };
}
type Data = Awaited<ReturnType<typeof loader>>;
export function Component() {
  const data = useLoaderData<typeof loader>();
  return <Content key={data.section + "-" + (data.id || "list")} data={data} />;
}
function Content({ data }: { data: Data }) {
  const { section, id, profile, template } = data,
    [params] = useSearchParams(),
    navigate = useNavigate(),
    after = useNavigateAfterSave(),
    r = useRevalidator();
  const [simulate, setSimulate] = useState(false);
  const [testProfile, setTestProfile] = useState<string>();
  const [mode, setMode] = useState<"create" | "edit" | "auth">(),
    [test, setTest] = useState(false),
    [action, setAction] = useState<"delete" | "toggle">(),
    [rev, setRev] = useState(0),
    [dirty, setDirty] = useState(false);
  const list = base + "/" + section + "?" + params,
    title =
      profile?.name ||
      template?.name ||
      (id === "new" ? "创建短信模板" : "短信");
  const back = () => navigate(list);
  function refresh() {
    setRev((v) => v + 1);
    void r.revalidate();
  }
  return (
    <section className="space-y-5">
      <div
        className={
          id
            ? "flex flex-wrap items-center justify-between gap-3"
            : "flex flex-wrap items-center justify-between gap-2 border-b pb-2"
        }
      >
        <h1 className={id ? "break-words text-2xl font-semibold" : "sr-only"}>
          {title}
        </h1>
        {!id && (
          <nav className="flex flex-wrap gap-1" aria-label="短信功能">
            {Object.entries(sections).map(([key, name]) => (
              <Link
                key={key}
                to={base + "/" + key}
                aria-current={section === key ? "page" : undefined}
                className={
                  "rounded-md px-3 py-2 text-sm " +
                  (section === key
                    ? "bg-accent font-medium"
                    : "text-muted-foreground hover:bg-muted")
                }
              >
                {name}
              </Link>
            ))}
          </nav>
        )}
        <div className="flex flex-wrap gap-2">
          {(!id ||
            profile?.enabled ||
            (template?.enabled && template.mode === "remote")) && (
            <Button
              variant={id ? "default" : "outline"}
              disabled={dirty}
              onClick={() => {
                setTestProfile(profile?.id);
                setTest(true);
              }}
            >
              <MessageSquare />
              发送测试
            </Button>
          )}
          {(profile || template) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={dirty}
                  aria-label="短信更多操作"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {profile && (
                  <>
                    <DropdownMenuItem onSelect={() => setAction("toggle")}>
                      <Power />
                      {profile.enabled ? "停用配置" : "启用配置"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setAction("delete")}
                >
                  <Trash2 />
                  删除{profile ? "配置" : "模板"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {!id && (
        <List
          createAction={
            <>
              {" "}
              {section === "profiles" && (
                <Button onClick={() => setMode("create")}>
                  <Plus />
                  创建配置
                </Button>
              )}
              {section === "templates" && (
                <Button asChild>
                  <Link to={base + "/templates/new"}>
                    <Plus />
                    创建模板
                  </Link>
                </Button>
              )}
            </>
          }
          section={section}
          revision={rev}
          onTest={(id) => {
            setTestProfile(id);
            setTest(true);
          }}
        />
      )}
      {profile && (
        <>
          <section className="max-w-4xl space-y-5 rounded-xl border bg-card p-5">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                阿里云短信 · <EnabledStatus enabled={profile.enabled} />
              </h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMode("edit")}
                >
                  编辑配置
                </Button>
              </div>
            </header>
            <ValuesGrid
              items={[
                ["配置编码", profile.code],
                ["AccessKey ID", profile.access_key_id],
                ["说明", profile.description || "—"],
              ]}
            />
            <Button variant="outline" onClick={() => setMode("auth")}>
              替换认证
            </Button>
          </section>
          <section className="max-w-4xl space-y-3 rounded-xl border bg-card p-5">
            <h2 className="font-semibold">最近发送</h2>
            {profile.latest ? (
              <LogValues log={profile.latest} />
            ) : (
              <p className="text-muted-foreground">尚无发送记录。</p>
            )}
          </section>
        </>
      )}
      {template?.mode === "local" && (
        <Button
          variant="outline"
          disabled={dirty || !template.enabled}
          onClick={() => setSimulate(true)}
        >
          模拟渲染
        </Button>
      )}
      {simulate && template && (
        <Simulation
          template={template}
          tag={data.tag}
          onDone={refresh}
          onClose={() => setSimulate(false)}
        />
      )}
      {(template || id === "new") && (
        <TemplateEditor
          template={template}
          tag={data.tag}
          onDirty={setDirty}
          onSaved={(t) => {
            if (!template) after(appHref(base + "/templates/" + t.id));
            else refresh();
          }}
        />
      )}
      {template?.latest && (
        <details className="max-w-3xl rounded-xl border bg-card p-4">
          <summary>最近发送测试</summary>
          <LogValues log={template.latest} />
        </details>
      )}
      {data.log && (
        <FormDrawer
          title="短信发送记录"
          description={data.log.test_id}
          onClose={back}
          footer={(close) => (
            <Button variant="outline" onClick={() => close()}>
              关闭
            </Button>
          )}
        >
          <LogValues log={data.log} />
        </FormDrawer>
      )}
      {mode && (
        <ProfileEditor
          authOnly={mode === "auth"}
          profile={profile}
          tag={data.tag}
          onClose={() => setMode(undefined)}
          onSaved={(savedId) => {
            if (mode === "create")
              after(appHref(base + "/profiles/" + savedId));
            else {
              setMode(undefined);
              refresh();
            }
          }}
        />
      )}
      {test && (
        <SendTest
          profileId={testProfile}
          initial={template}
          onClose={() => setTest(false)}
          onDone={refresh}
        />
      )}
      {action && (
        <Command
          path={base + "/" + section + "/" + id}
          name={title}
          tag={data.tag}
          action={action}
          enabled={!!profile?.enabled}
          onClose={() => setAction(undefined)}
          onSaved={() => {
            if (action === "delete") after(appHref(list));
            else {
              setAction(undefined);
              refresh();
            }
          }}
        />
      )}
    </section>
  );
}
function Command({
  path,
  name,
  tag,
  action,
  enabled,
  onClose,
  onSaved,
}: {
  path: string;
  name: string;
  tag: string;
  action: "delete" | "toggle";
  enabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [snapshot] = useState({ tag, enabled }),
    save = useSubmission(),
    [error, setError] = useState("");
  const remove = action === "delete";
  return (
    <FormDialog
      compact
      open
      title={
        remove ? "删除短信资源" : enabled ? "停用短信配置" : "启用短信配置"
      }
      description={name}
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
                  await request(path, {
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
          ? "删除后，既有发送日志保留至到期。"
          : "该状态影响后续测试和发送。"}
      </p>
    </FormDialog>
  );
}
function List({
  createAction,
  section,
  revision,
  onTest,
}: {
  createAction: import("react").ReactNode;
  section: Section;
  revision: number;
  onTest: (id: string) => void;
}) {
  const [params, setParams] = useSearchParams(),
    date = useDate(),
    q = params.get("q") || "",
    status = params.get("status") || "",
    profile = params.get("profile_id") || "",
    days = ["1", "7", "30"].includes(params.get("days") || "")
      ? params.get("days")!
      : "30",
    size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
      ? Number(params.get("page_size"))
      : 20,
    page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const [profileFilter, setProfileFilter] = useState({
    value: profile,
    open: Boolean(profile),
  });
  const profileFilterOpen =
    profileFilter.value === profile ? profileFilter.open : Boolean(profile);
  const [clock, setClock] = useState(Date.now),
    from = useMemo(
      () => new Date(clock - Number(days) * 86400000).toISOString(),
      [days, clock],
    ),
    filters = new URLSearchParams({
      page: String(page),
      page_size: String(size),
      q,
      status,
    });
  if (section === "send-logs") {
    filters.set("from", from);
    if (profile) filters.set("profile_id", profile);
  }
  const query = useQuery<Page<Profile | Template | Log>>(
    base + "/" + section + "?" + filters,
    revision,
  );
  function filter(values: Record<string, string>) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("page");
      for (const [k, v] of Object.entries(values)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      return next;
    });
  }
  const data = query.data;
  useEffect(() => {
    if (data && !data.items.length && page > 1) {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("page", String(Math.max(1, Math.ceil(data.total / size))));
          return next;
        },
        { replace: true },
      );
    }
  }, [data, page, size, setParams]);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="list-toolbar">
        <form
          className={
            section === "send-logs"
              ? "flex w-full min-w-0 gap-2 sm:w-80 sm:flex-none"
              : "flex basis-full flex-wrap items-start gap-2 sm:max-w-md sm:flex-1"
          }
          onSubmit={(e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            filter({ q: String(d.get("q") || "") });
          }}
        >
          <Input
            className="min-w-0 flex-1"
            name="q"
            key={q}
            aria-label="搜索短信记录"
            defaultValue={q}
            placeholder={
              section === "send-logs"
                ? "搜索配置名称或测试编号"
                : "搜索名称或编码"
            }
          />
          <Button variant="outline">搜索</Button>
        </form>
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <NativeSelect
            className="w-auto"
            aria-label="状态筛选"
            value={status}
            onChange={(e) => filter({ status: e.target.value })}
          >
            <option value="">全部状态</option>
            {Object.entries(
              section === "send-logs"
                ? labels
                : { enabled: "已启用", disabled: "已停用" },
            ).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </NativeSelect>
          {section === "send-logs" && (
            <NativeSelect
              className="w-auto"
              aria-label="日志时间"
              value={days}
              onChange={(e) => filter({ days: e.target.value })}
            >
              {[30, 7, 1].map((n) => (
                <option key={n} value={n}>
                  近 {n} 天
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        {section === "send-logs" && (
          <>
            <Button
              type="button"
              variant={profile ? "secondary" : "outline"}
              aria-expanded={profileFilterOpen}
              aria-controls="sms-log-profile-filter"
              onClick={() =>
                setProfileFilter({ value: profile, open: !profileFilterOpen })
              }
            >
              <SlidersHorizontal />
              配置筛选{profile && " · 已应用"}
              <ChevronDown
                className={profileFilterOpen ? "rotate-180" : undefined}
              />
            </Button>
            {(q || status || profile || days !== "30") && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  filter({ q: "", status: "", profile_id: "", days: "" })
                }
              >
                清除全部筛选
              </Button>
            )}
          </>
        )}
        <div className={section === "send-logs" ? "ml-auto" : undefined}>
          <RefreshButton
            loading={query.loading}
            onClick={() => {
              setClock(Date.now());
              query.refresh();
            }}
          />
        </div>
        {section !== "send-logs" && (
          <div className="sm:ml-auto">{createAction}</div>
        )}
        {section === "send-logs" && profileFilterOpen && (
          <form
            id="sms-log-profile-filter"
            className="flex min-w-0 basis-full flex-wrap items-end gap-2 border-t pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              filter({
                profile_id: String(
                  new FormData(e.currentTarget).get("profile") || "",
                ),
              });
            }}
          >
            <label className="grid w-full min-w-0 gap-1.5 text-sm sm:w-80">
              发送配置 ID
              <Input
                key={profile}
                name="profile"
                aria-label="配置 ID"
                defaultValue={profile}
                placeholder="输入配置 ID"
                autoComplete="off"
              />
            </label>
            <Button type="submit" variant="outline">
              应用筛选
            </Button>
          </form>
        )}
      </div>
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.refresh}
        empty={!data?.items.length}
        emptyContent={
          <EmptyState
            title={
              q || status || profile
                ? "没有匹配的记录"
                : section === "send-logs"
                  ? "所选时间内暂无发送记录"
                  : section === "templates"
                    ? "还没有短信模板"
                    : "还没有短信配置"
            }
            description={
              q || status || profile
                ? "调整搜索条件，或清除筛选查看全部记录。"
                : section === "send-logs"
                  ? "发送测试后可在这里核对结果，记录保留 30 天。"
                  : section === "templates"
                    ? "将短信内容与参数保存为模板，可按模式使用本地模拟或远端发送测试。"
                    : "添加短信服务认证信息，再发送一次测试确认配置。"
            }
            action={
              section === "send-logs" ? undefined : q || status || profile ? (
                <Button
                  variant="outline"
                  onClick={() => filter({ q: "", status: "", profile_id: "" })}
                >
                  清除筛选
                </Button>
              ) : (
                createAction
              )
            }
          />
        }
      >
        <Table aria-label={sections[section]}>
          <TableHeader>
            <TableRow>
              {(section === "send-logs"
                ? ["发送配置", "接收号码", "结果", "开始时间", "操作"]
                : [
                    "名称",
                    section === "profiles" ? "供应商" : "模板模式",
                    "状态",
                    section === "profiles" ? "最近测试" : "更新时间",
                    "操作",
                  ]
              ).map((t) => (
                <TableHead key={t}>{t}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((item) => {
              const href = base + "/" + section + "/" + item.id + "?" + params;
              if ("test_id" in item)
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      {item.profile_name}
                      <small className="block text-muted-foreground">
                        {item.template_name || "—"}
                      </small>
                    </TableCell>
                    <TableCell>{item.recipient_mask}</TableCell>
                    <TableCell>
                      <OperationStatus value={item.status}>
                        {labels[item.status] || item.status}
                      </OperationStatus>
                      <small className="block text-muted-foreground">
                        {explain(item)}
                      </small>
                    </TableCell>
                    <TableCell>
                      {date(item.started_at)}
                      <small className="block text-muted-foreground">
                        {item.actor_name}
                      </small>
                    </TableCell>
                    <TableCell>
                      <Link className="hover:underline" to={href}>
                        查看记录
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link to={href} className="font-medium hover:underline">
                      {item.name}
                    </Link>
                    <small className="block text-muted-foreground">
                      {item.code}
                    </small>
                  </TableCell>
                  <TableCell>
                    {"config" in item
                      ? "阿里云短信"
                      : item.mode === "remote"
                        ? "远端模板"
                        : "本地模拟正文"}
                    {!("config" in item) && (
                      <small className="block text-muted-foreground">
                        {item.mode === "remote"
                          ? item.remote_template_id
                          : "Go 模板 · v" + item.engine_version}
                      </small>
                    )}
                  </TableCell>
                  <TableCell>
                    <EnabledStatus enabled={item.enabled} />
                  </TableCell>
                  <TableCell>
                    {"config" in item ? (
                      item.latest ? (
                        <OperationStatus
                          value={
                            item.latest.outdated
                              ? "outdated"
                              : item.latest.status
                          }
                        >
                          {item.latest.outdated && "历史 · "}
                          {labels[item.latest.status] || item.latest.status}
                        </OperationStatus>
                      ) : (
                        "尚无记录"
                      )
                    ) : (
                      date("updated_at" in item ? item.updated_at : undefined)
                    )}
                  </TableCell>
                  <TableCell>
                    <Link className="hover:underline" to={href}>
                      查看
                    </Link>
                    {"config" in item && (
                      <Button
                        className="ml-2"
                        size="sm"
                        variant="ghost"
                        disabled={!item.enabled}
                        onClick={() => onTest(item.id)}
                      >
                        测试
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </AsyncState>
      {data && (
        <Pagination
          page={page}
          size={size}
          total={data.total}
          onChange={(n, s) => filter({ page: String(n), page_size: String(s) })}
        />
      )}
    </div>
  );
}
