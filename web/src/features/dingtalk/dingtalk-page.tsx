import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  KeyRound,
  Pencil,
  Plus,
  Power,
  Send,
  Trash2,
} from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { DescriptionList, PageHeader, Panel } from "@/components/layout";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { CopyButton } from "@/components/copy-button";
import {
  RowActions,
  RowAction,
  RowActionSeparator,
} from "@/components/row-actions";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import { formatDate } from "@/lib/utils";
import {
  messageReasons,
  messageStatusLabels,
  type DingTalkRobot,
} from "@/types/messages";

const base = "/admin/dingtalk/robots";
interface Page {
  items: DingTalkRobot[];
  total: number;
  page: number;
  page_size: number;
}
type Diagnostic = NonNullable<DingTalkRobot["latest"]>;

export function DingTalkPage() {
  const { id } = useParams();
  return (
    <div className="page">{id ? <RobotDetail id={id} /> : <RobotList />}</div>
  );
}

function RobotList() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const status = params.get("status") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const size = [10, 20, 50, 100].includes(Number(params.get("page_size")))
    ? Number(params.get("page_size"))
    : 20;
  const query = useApiQuery<Page>(
    ["dingtalk-robots", q, status, page, size],
    `${base}?${new URLSearchParams({ q, status, page: String(page), page_size: String(size) })}`,
  );
  const [create, setCreate] = useState(false);
  const queryClient = useQueryClient();
  function filter(values: Record<string, string>) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", "1");
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  }
  return (
    <>
      <PageHeader title="钉钉机器人" />
      <Panel bodyClassName="p-0">
        <TableToolbar
          onReset={() => filter({ q: "", status: "" })}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching}
          actions={
            <Button onClick={() => setCreate(true)}>
              <Plus />
              新建机器人
            </Button>
          }
        >
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              filter({
                q: String(new FormData(event.currentTarget).get("q") ?? ""),
              });
            }}
          >
            <StandaloneInput
              name="q"
              aria-label="搜索机器人"
              defaultValue={q}
              placeholder="搜索名称或标识"
            />
          </form>
          <StandaloneSelect
            aria-label="机器人状态"
            value={status}
            onValueChange={(value) => filter({ status: value })}
          >
            <option value="">全部状态</option>
            <option value="enabled">已启用</option>
            <option value="disabled">已停用</option>
          </StandaloneSelect>
        </TableToolbar>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
          empty={!query.data?.data.items.length}
          emptyTitle="还没有钉钉机器人"
        >
          {query.data && (
            <SimpleTable
              actions
              label="钉钉机器人"
              headers={["机器人", "状态", "最近测试", "操作"]}
            >
              {query.data.data.items.map((robot) => (
                <tr key={robot.id}>
                  <td>
                    <Link
                      className="font-medium text-foreground hover:text-primary"
                      to={`/admin/dingtalk/${robot.id}`}
                    >
                      {robot.name}
                    </Link>
                    <small className="mono block text-muted">
                      {robot.code}
                    </small>
                  </td>
                  <td>
                    <StatusBadge tone={robot.enabled ? "success" : "neutral"}>
                      {robot.enabled ? "已启用" : "已停用"}
                    </StatusBadge>
                  </td>
                  <td>
                    {robot.latest ? (
                      <StatusBadge
                        tone={
                          robot.latest.status === "accepted"
                            ? "success"
                            : robot.latest.status === "unknown"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {robot.latest.outdated ? "历史 · " : ""}
                        {messageStatusLabels[robot.latest.status] ??
                          robot.latest.status}
                      </StatusBadge>
                    ) : (
                      "尚无记录"
                    )}
                  </td>
                  <td>
                    <Link className="link" to={`/admin/dingtalk/${robot.id}`}>
                      查看
                    </Link>
                  </td>
                </tr>
              ))}
            </SimpleTable>
          )}
        </AsyncBoundary>
        {query.data && (
          <Pagination
            page={page}
            size={size}
            total={query.data.data.total}
            pending={query.isFetching}
            onChange={(nextPage, nextSize) =>
              setParams((current) => {
                const next = new URLSearchParams(current);
                next.set("page", String(nextPage));
                next.set("page_size", String(nextSize));
                return next;
              })
            }
          />
        )}
      </Panel>
      <OverlayPresence>
        {create && (
          <RobotEditor
            onClose={() => setCreate(false)}
            onSaved={async (id) => {
              setCreate(false);
              await queryClient.invalidateQueries({
                queryKey: ["dingtalk-robots"],
              });
              window.location.assign(`/admin/dingtalk/${id}`);
            }}
          />
        )}
      </OverlayPresence>
    </>
  );
}

function RobotDetail({ id }: { id: string }) {
  const query = useApiQuery<DingTalkRobot>(
    ["dingtalk-robot", id],
    `${base}/${id}`,
  );
  const [mode, setMode] = useState<"edit" | "auth" | null>(null);
  const [test, setTest] = useState(false);
  const [remove, setRemove] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const submission = useSubmission();
  if (query.isPending || query.error)
    return (
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  const robot = query.data.data;
  return (
    <section>
      <Link
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted hover:text-foreground"
        to="/admin/dingtalk"
      >
        <ArrowLeft className="size-4" />
        返回列表
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="break-all">{robot.name}</span>
            <StatusBadge tone={robot.enabled ? "success" : "neutral"}>
              {robot.enabled ? "已启用" : "已停用"}
            </StatusBadge>
          </span>
        }
        actions={
          <>
            <RowActions label={robot.name} disabled={submission.pending}>
              <RowAction
                icon={<Power />}
                onSelect={() =>
                  void submission.run(async () => {
                    await request(`${base}/${id}`, {
                      method: "PATCH",
                      etag: query.data.etag,
                      body: { enabled: !robot.enabled },
                    });
                    await query.refetch();
                    await queryClient.invalidateQueries({
                      queryKey: ["dingtalk-robots"],
                    });
                  })
                }
              >
                {robot.enabled ? "停用机器人" : "启用机器人"}
              </RowAction>
              <RowActionSeparator />
              <RowAction
                icon={<Trash2 />}
                variant="destructive"
                disabled={robot.latest?.status === "in_progress"}
                onSelect={() => setRemove(true)}
              >
                删除机器人
              </RowAction>
            </RowActions>
          </>
        }
      />
      {!remove && <ErrorNotice error={submission.error} />}
      <div className="grid gap-5">
        <Panel
          title="基本信息"
          action={
            <Button variant="outline" size="sm" onClick={() => setMode("edit")}>
              <Pencil />
              编辑资料
            </Button>
          }
        >
          <DescriptionList
            items={[
              { label: "名称", value: robot.name },
              {
                label: "编码",
                value: (
                  <span className="inline-flex max-w-full items-center gap-2">
                    <span className="mono break-all">{robot.code}</span>
                    <CopyButton value={robot.code} label="复制机器人编码" />
                  </span>
                ),
              },
              { label: "创建时间", value: formatDate(robot.created_at) },
              { label: "更新时间", value: formatDate(robot.updated_at) },
              {
                label: "说明",
                value: (
                  <div className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words">
                    {robot.description || "未填写"}
                  </div>
                ),
                full: true,
              },
            ]}
          />
        </Panel>
        <Panel
          title="机器人认证"
          action={
            <Button variant="outline" size="sm" onClick={() => setMode("auth")}>
              <KeyRound />
              更新认证
            </Button>
          }
        >
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted">Access Token 与签名密钥</span>
            <StatusBadge tone={robot.has_secret ? "neutral" : "warning"}>
              {robot.has_secret ? "已配置" : "未配置"}
            </StatusBadge>
          </div>
        </Panel>
        <Panel
          title="最近测试"
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                刷新结果
              </Button>
              <Button
                size="sm"
                disabled={
                  !robot.enabled ||
                  robot.latest?.status === "in_progress" ||
                  submission.pending
                }
                onClick={() => setTest(true)}
              >
                <Send />
                发送测试
              </Button>
            </div>
          }
        >
          {(!robot.enabled || robot.latest?.status === "in_progress") && (
            <p className="mb-3 text-sm text-muted">
              {robot.latest?.status === "in_progress"
                ? "测试正在发送，请等待结果后再发送。"
                : "机器人已停用，启用后可发送测试。"}
            </p>
          )}
          {robot.latest ? (
            <Result value={robot.latest} />
          ) : (
            <p className="text-sm text-muted">尚无测试记录</p>
          )}
        </Panel>
      </div>
      <OverlayPresence>
        {mode && (
          <RobotEditor
            robot={robot}
            etag={query.data.etag}
            onReload={() => void query.refetch()}
            authOnly={mode === "auth"}
            onClose={() => setMode(null)}
            onSaved={async () => {
              setMode(null);
              await queryClient.invalidateQueries({
                queryKey: ["dingtalk-robot", id],
              });
              await queryClient.invalidateQueries({
                queryKey: ["dingtalk-robots"],
              });
            }}
          />
        )}
      </OverlayPresence>
      <OverlayPresence>
        {test && <RobotTest robot={robot} onClose={() => setTest(false)} />}
      </OverlayPresence>
      <ConfirmDialog
        open={remove}
        danger
        title="删除机器人"
        description={robot.name}
        confirmLabel="删除机器人"
        pending={submission.pending}
        onClose={() => setRemove(false)}
        onConfirm={() =>
          void submission.run(async () => {
            await request(`${base}/${id}`, {
              method: "DELETE",
              etag: query.data.etag,
            });
            navigate("/admin/dingtalk");
            await queryClient.invalidateQueries({
              queryKey: ["dingtalk-robots"],
            });
          })
        }
      >
        <ErrorNotice error={submission.error} />
        <p className="text-sm text-muted">本地认证材料将删除；审计历史保留。</p>
      </ConfirmDialog>
    </section>
  );
}

function RobotEditor({
  robot,
  etag,
  authOnly = false,
  onReload,
  onClose,
  onSaved,
}: {
  robot?: DingTalkRobot;
  etag?: string;
  authOnly?: boolean;
  onReload?: () => void;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: robot?.code ?? "",
    name: robot?.name ?? "",
    description: robot?.description ?? "",
    enabled: robot?.enabled ?? true,
    access_token: "",
    secret: "",
  });
  const errors = useFormErrors();
  const submission = useSubmission();
  const dirty =
    form.name !== (robot?.name ?? "") ||
    form.code !== (robot?.code ?? "") ||
    form.description !== (robot?.description ?? "") ||
    Boolean(form.access_token || form.secret);
  const markSaved = useUnsaved(dirty, submission.pending);
  async function save() {
    if (submission.pending) return;
    errors.clear();
    if (!authOnly && !form.name.trim()) {
      errors.validate({
        name: !form.name.trim() ? "请输入名称" : "",
      });
      return;
    }
    if ((!robot || authOnly) && (!form.access_token || !form.secret)) {
      errors.validate({
        access_token: !form.access_token ? "请输入 Access Token" : "",
        secret: !form.secret ? "请输入签名密钥" : "",
      });
      return;
    }
    await submission.run(
      async () => {
        const response =
          authOnly && robot
            ? await request<DingTalkRobot>(
                `${base}/${robot.id}/authentication`,
                {
                  method: "PUT",
                  etag,
                  body: {
                    access_token: form.access_token,
                    secret: form.secret,
                  },
                },
              )
            : await request<DingTalkRobot>(
                robot ? `${base}/${robot.id}` : base,
                {
                  method: robot ? "PATCH" : "POST",
                  etag: robot ? etag : undefined,
                  body: {
                    ...(robot
                      ? {}
                      : {
                          code: form.code.trim(),
                          authentication: {
                            access_token: form.access_token,
                            secret: form.secret,
                          },
                        }),
                    name: form.name.trim(),
                    description: form.description,
                    enabled: form.enabled,
                  },
                },
              );
        markSaved();
        await onSaved(response.data.id);
      },
      (error) =>
        errors.show(error, [
          "name",
          "code",
          "description",
          "access_token",
          "secret",
        ]),
    );
  }
  return (
    <Drawer
      open
      title={
        authOnly ? "更新机器人认证" : robot ? "编辑机器人资料" : "新建机器人"
      }
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <SheetClose asChild>
            <Button variant="outline" disabled={submission.pending}>
              取消
            </Button>
          </SheetClose>
          <Button pending={submission.pending} onClick={() => void save()}>
            保存
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice
          error={
            errors.error ||
            (Object.keys(errors.fields).length ? null : submission.error)
          }
        />
        {submission.error instanceof ApiError &&
          ["VERSION_CONFLICT", "PRECONDITION_REQUIRED"].includes(
            submission.error.code,
          ) &&
          onReload && (
            <Button variant="outline" onClick={onReload}>
              重新加载当前版本
            </Button>
          )}
        {!authOnly && (
          <>
            <Field label="名称" required error={errors.fields.name}>
              <Input
                name="name"
                maxLength={100}
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field
              label={robot ? "编码" : "编码（可选）"}
              error={errors.fields.code}
            >
              <Input
                className="mono"
                name="code"
                maxLength={64}
                readOnly={Boolean(robot)}
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
          </>
        )}
        {(!robot || authOnly) && (
          <>
            <Field
              label="Access Token"
              required
              error={errors.fields.access_token}
            >
              <Input
                type="password"
                name="access_token"
                autoComplete="off"
                value={form.access_token}
                onChange={(event) =>
                  setForm({ ...form, access_token: event.target.value })
                }
              />
            </Field>
            <Field label="签名密钥" required error={errors.fields.secret}>
              <Input
                type="password"
                name="secret"
                autoComplete="off"
                value={form.secret}
                onChange={(event) =>
                  setForm({ ...form, secret: event.target.value })
                }
              />
            </Field>
          </>
        )}
        {!authOnly && (
          <Field label="说明（可选）" error={errors.fields.description}>
            <Textarea
              name="description"
              maxLength={1000}
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </Field>
        )}
      </form>
    </Drawer>
  );
}

function RobotTest({
  robot,
  onClose,
}: {
  robot: DingTalkRobot;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ format: "text", title: "", body: "" });
  const [result, setResult] = useState<Diagnostic | null>(null);
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  async function send() {
    if (
      submission.pending ||
      !robot.enabled ||
      robot.latest?.status === "in_progress"
    )
      return;
    errors.clear();
    if (!form.body || (form.format === "markdown" && !form.title.trim())) {
      errors.validate({
        body: !form.body ? "请输入正文" : "",
        title:
          form.format === "markdown" && !form.title.trim()
            ? "Markdown 必须填写标题"
            : "",
      });
      return;
    }
    await submission.run(
      async () => {
        const response = await request<Diagnostic>(`${base}/${robot.id}/test`, {
          method: "POST",
          etag: `"${robot.version}"`,
          body: { format: form.format, title: form.title, body: form.body },
        });
        setResult(response.data);
        await queryClient.invalidateQueries({
          queryKey: ["dingtalk-robot", robot.id],
        });
        await queryClient.invalidateQueries({ queryKey: ["dingtalk-robots"] });
      },
      (error) => errors.show(error, ["body", "title"]),
    );
  }
  return (
    <Drawer
      open
      title="发送钉钉测试"
      description={`发送到 ${robot.name} 所在的钉钉群`}
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <SheetClose asChild>
            <Button variant="outline" disabled={submission.pending}>
              关闭
            </Button>
          </SheetClose>
          <Button
            pending={submission.pending}
            disabled={!robot.enabled || robot.latest?.status === "in_progress"}
            onClick={() => void send()}
          >
            <Send />
            确认发送
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <ErrorNotice error={errors.error} />
        {result && <Result value={result} />}
        <Field label="消息格式">
          <Select
            value={form.format}
            onValueChange={(value) => setForm({ ...form, format: value })}
          >
            <option value="text">文本</option>
            <option value="markdown">Markdown</option>
          </Select>
        </Field>
        {form.format === "markdown" && (
          <Field label="Markdown 标题" required error={errors.fields.title}>
            <Input
              name="title"
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </Field>
        )}
        <Field label="正文" required error={errors.fields.body}>
          <Textarea
            name="body"
            className="min-h-40"
            value={form.body}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
          />
        </Field>
      </form>
    </Drawer>
  );
}

function Result({ value }: { value: Diagnostic }) {
  const tone =
    value.status === "accepted"
      ? "success"
      : value.status === "unknown"
        ? "warning"
        : value.status === "in_progress"
          ? "neutral"
          : "danger";
  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={tone}>
          {messageStatusLabels[value.status] ?? value.status}
        </StatusBadge>
        <span className="text-muted">{formatDate(value.started_at)}</span>
        {value.outdated && <StatusBadge tone="warning">历史结果</StatusBadge>}
      </div>
      <p>{messageReasons[value.reason_code] ?? value.reason_code}</p>
      {value.outdated && (
        <p className="text-muted">配置已变化，此结果来自修改前的配置。</p>
      )}
      {value.status === "unknown" && (
        <p className="text-warning">
          请先到钉钉群核实消息，再决定是否重新发送。
        </p>
      )}
      <details className="text-muted">
        <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          诊断详情
        </summary>
        <dl className="mt-3 grid gap-2 break-all">
          <div>
            <dt className="inline">测试编号：</dt>
            <dd className="mono inline">{value.test_id}</dd>
          </div>
          <div>
            <dt className="inline">处理阶段：</dt>
            <dd className="inline">{value.stage}</dd>
          </div>
          <div>
            <dt className="inline">结果代码：</dt>
            <dd className="mono inline">{value.reason_code}</dd>
          </div>
          {value.finished_at && (
            <div>
              <dt className="inline">完成时间：</dt>
              <dd className="inline">{formatDate(value.finished_at)}</dd>
            </div>
          )}
        </dl>
      </details>
    </div>
  );
}
