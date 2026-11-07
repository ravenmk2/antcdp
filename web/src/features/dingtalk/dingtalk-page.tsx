import { OverlayPresence } from "@/components/overlay-presence";
import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
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
      <PageHeader
        title="钉钉机器人"
        description="独立维护群机器人 Access Token、加签、关键词与文本 / Markdown 测试。"
      />
      <Notice className="mb-5">
        只输入 Access Token，不输入完整 Webhook
        URL。测试会真实发往机器人群；不支持 @ 提醒。
      </Notice>
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
              headers={["机器人", "关键词", "状态", "最近测试", "操作"]}
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
                  <td>{robot.keyword}</td>
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
      <PageHeader
        title={robot.name}
        description={robot.code}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => navigate("/admin/dingtalk")}
            >
              <ArrowLeft />
              返回列表
            </Button>
            <Button disabled={!robot.enabled} onClick={() => setTest(true)}>
              <Send />
              发送测试
            </Button>
            <Button variant="outline" onClick={() => setMode("edit")}>
              <Pencil />
              编辑配置
            </Button>
            <Button variant="dangerSoft" onClick={() => setRemove(true)}>
              <Trash2 />
              删除
            </Button>
          </>
        }
      />
      <div className="split-workspace">
        <Panel title="机器人配置">
          <DescriptionList
            items={[
              { label: "关键词", value: robot.keyword },
              { label: "状态", value: robot.enabled ? "已启用" : "已停用" },
              {
                label: "Access Token / 加签",
                value: robot.has_secret ? "已加密保存" : "未配置",
              },
              { label: "说明", value: robot.description || "—", full: true },
            ]}
          />
          <div className="mt-5 flex gap-2 border-t pt-4">
            <Button variant="outline" onClick={() => setMode("auth")}>
              替换认证
            </Button>
            <Button
              variant="outline"
              onClick={() =>
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
            </Button>
          </div>
          <ErrorNotice error={submission.error} />
        </Panel>
        <Panel title="最近测试">
          {robot.latest ? (
            <Result value={robot.latest} />
          ) : (
            <p className="text-sm text-muted">尚无测试记录。</p>
          )}
        </Panel>
      </div>
      <OverlayPresence>
        {mode && (
          <RobotEditor
            robot={robot}
            etag={query.data.etag}
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
  onClose,
  onSaved,
}: {
  robot?: DingTalkRobot;
  etag?: string;
  authOnly?: boolean;
  onClose: () => void;
  onSaved: (id: string) => Promise<void>;
}) {
  const [form, setForm] = useState({
    code: robot?.code ?? "",
    name: robot?.name ?? "",
    description: robot?.description ?? "",
    enabled: robot?.enabled ?? true,
    keyword: robot?.keyword ?? "",
    access_token: "",
    secret: "",
  });
  const errors = useFormErrors();
  const submission = useSubmission();
  useUnsaved(true, submission.pending);
  async function save() {
    if (!authOnly && (!form.name.trim() || !form.keyword.trim())) {
      errors.validate({
        name: !form.name.trim() ? "请输入名称" : "",
        keyword: !form.keyword.trim() ? "请输入关键词" : "",
      });
      return;
    }
    if ((!robot || authOnly) && (!form.access_token || !form.secret)) {
      errors.validate({
        access_token: !form.access_token ? "请输入 Access Token" : "",
        secret: !form.secret ? "请输入加签秘密" : "",
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
                    keyword: form.keyword,
                  },
                },
              );
        await onSaved(response.data.id);
      },
      (error) =>
        errors.show(error, [
          "name",
          "code",
          "keyword",
          "access_token",
          "secret",
        ]),
    );
  }
  return (
    <Drawer
      open
      title={authOnly ? "替换机器人认证" : robot ? "编辑机器人" : "新建机器人"}
      description="Token 与加签秘密完整替换；离开表单即清除"
      dirty
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
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
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {!authOnly && (
          <>
            <Field label="名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field label="编码（可选）">
              <Input
                className="mono"
                readOnly={Boolean(robot)}
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
            <Field label="说明">
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </Field>
            <Field
              label="关键词"
              required
              hint="发送时作为前缀加入内容"
              error={errors.fields.keyword}
            >
              <Input
                name="keyword"
                value={form.keyword}
                onChange={(event) =>
                  setForm({ ...form, keyword: event.target.value })
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
                autoComplete="off"
                value={form.access_token}
                onChange={(event) =>
                  setForm({ ...form, access_token: event.target.value })
                }
              />
            </Field>
            <Field label="加签秘密" required error={errors.fields.secret}>
              <Input
                type="password"
                autoComplete="off"
                value={form.secret}
                onChange={(event) =>
                  setForm({ ...form, secret: event.target.value })
                }
              />
            </Field>
          </>
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
  const preview = `${robot.keyword}\n${form.body}`;
  async function send() {
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
      },
      (error) => errors.show(error, ["body", "title"]),
    );
  }
  return (
    <Drawer
      open
      title="发送钉钉测试"
      description="真实外发到机器人群；受理不代表成员已读"
      onClose={onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
          <Button pending={submission.pending} onClick={() => void send()}>
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
        <ErrorNotice error={submission.error} />
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
        <Field label="发送内容预览">
          <Textarea readOnly className="min-h-32 font-mono" value={preview} />
        </Field>
      </form>
    </Drawer>
  );
}

function Result({ value }: { value: Diagnostic }) {
  return (
    <Notice
      tone={
        value.status === "accepted"
          ? "success"
          : value.status === "unknown"
            ? "warning"
            : "danger"
      }
    >
      {value.outdated ? "历史结果 · " : ""}
      {messageStatusLabels[value.status] ?? value.status} ·{" "}
      {messageReasons[value.reason_code] ?? value.reason_code}
      <small className="mt-1 block">
        {value.test_id} · {formatDate(value.started_at)}
      </small>
    </Notice>
  );
}
