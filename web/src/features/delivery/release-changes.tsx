import { TableToolbar } from "@/components/table-toolbar";
import { useState } from "react";
import { Pagination } from "@/components/pagination";
import {
  GitMerge,
  GitPullRequest,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { request, isUncertain } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice, StatusBadge } from "@/components/feedback";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { Panel } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { SimpleTable } from "@/components/table";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { deliveryLabel, resultTone } from "@/domain/labels";
import { uuid } from "@/lib/utils";
import type {
  MergeRequest,
  ReleaseChange,
  ReleaseRepository,
} from "@/types/delivery";
import {
  evidenceString,
  releaseBase,
  type ReleaseViewProps,
} from "./release-types";

export function ReleaseChanges(props: ReleaseViewProps) {
  const { release, releaseEtag, materials, flow } = props;
  const base = releaseBase(props);
  const [add, setAdd] = useState<"mr" | "commit" | "revert" | null>(null);
  const [baseline, setBaseline] = useState<ReleaseRepository | null>(null);
  const [remote, setRemote] = useState<{
    action: "merge" | "create-revert";
    change: ReleaseChange;
  } | null>(null);
  const [remove, setRemove] = useState<ReleaseChange | null>(null);
  const [scope, setScope] = useState<{
    adds: string[];
    drops: string[];
    token: string;
  } | null>(null);
  const submission = useSubmission();
  const editing = ["draft", "integrating"].includes(release.status);
  async function previewScope() {
    await submission.run(async () => {
      const response = await request<{
        adds: string[];
        drops: string[];
        token: string;
      }>(`${base}/scope-preview`, {
        method: "POST",
        etag: releaseEtag,
        body: {},
      });
      setScope(response.data);
    });
  }
  async function refreshScope() {
    if (!scope) return;
    const ok = await submission.run(async () => {
      await request(`${base}/refresh-scope`, {
        method: "POST",
        etag: releaseEtag,
        body: { digest: scope.token },
      });
      await props.onChanged();
      setScope(null);
    });
    if (!ok) return;
  }
  return (
    <div className="grid gap-5">
      <Panel title="范围与基线">
        <TableToolbar
          onRefresh={props.onChanged}
          actions={
            release.status === "draft" &&
            flow.can_manage && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void previewScope()}
                >
                  预览范围变化
                </Button>
                {scope && (
                  <Button size="sm" onClick={() => void refreshScope()}>
                    确认刷新范围
                  </Button>
                )}
              </div>
            )
          }
        />

        <ErrorNotice error={submission.error} />
        {scope && (
          <Notice
            tone={scope.drops.length ? "warning" : "info"}
            className="mb-4"
          >
            <strong>
              新增 {scope.adds.length} · 移出 {scope.drops.length}
            </strong>
            {scope.adds.map((item) => (
              <div key={`add-${item}`}>＋ {item}</div>
            ))}
            {scope.drops.map((item) => (
              <div key={`drop-${item}`}>－ {item}</div>
            ))}
          </Notice>
        )}
        <SimpleTable
          label="发布仓库范围"
          headers={["仓库", "主干", "基线 SHA", "基线来源", "操作"]}
        >
          {materials.repositories.map((repo) => (
            <tr key={repo.id}>
              <td className="mono break-all text-xs">{repo.full_path}</td>
              <td className="mono">{repo.main_branch}</td>
              <td className="mono break-all text-xs">
                {repo.baseline_sha || "待采集"}
              </td>
              <td>{repo.baseline_kind || "—"}</td>
              <td>
                {release.status === "draft" && flow.can_manage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setBaseline(repo)}
                  >
                    确认基线
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </SimpleTable>
        {!materials.repositories.length && (
          <Notice tone="warning" className="mt-4">
            当前范围为空。可以保存草稿，但开始发布前必须配置至少一个范围仓库。
          </Notice>
        )}
      </Panel>
      <Panel title="MR 与直接提交">
        <TableToolbar
          onRefresh={props.onChanged}
          actions={
            editing && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAdd("mr")}
                >
                  <GitPullRequest />
                  选择 MR
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAdd("commit")}
                >
                  <Plus />
                  补录直接提交
                </Button>
                {flow.can_manage && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAdd("revert")}
                  >
                    <RotateCcw />
                    关联回退 MR
                  </Button>
                )}
              </div>
            )
          }
        />

        <Notice className="mb-4">
          候选 MR 按仓库加载；没有登记 MR
          的仓库仍属于完整发布范围，不表示“无变化”。
        </Notice>
        <SimpleTable
          label="发布变更"
          headers={["仓库", "变更", "状态", "说明", "操作"]}
        >
          {flow.changes.map((change) => {
            const repo = materials.repositories.find(
              (item) => item.id === change.repo_id,
            );
            const title = evidenceString(change, "title");
            return (
              <tr key={change.id}>
                <td className="mono break-all text-xs">
                  {repo?.full_path ?? change.repo_id}
                </td>
                <td>
                  <strong className="text-foreground">
                    {change.kind === "mr" ? `MR !${change.ref}` : "直接提交"}
                    {title ? ` · ${title}` : ""}
                  </strong>
                  <small className="mono block break-all text-muted">
                    {change.kind === "commit"
                      ? change.ref
                      : evidenceString(change, "sha")}
                  </small>
                </td>
                <td>
                  <StatusBadge tone={resultTone(change.status)}>
                    {deliveryLabel(change.status)}
                  </StatusBadge>
                  {change.reverted_by && (
                    <small className="block text-muted">
                      回退变更 {change.reverted_by}
                    </small>
                  )}
                </td>
                <td className="max-w-sm whitespace-normal text-xs">
                  {change.note || "—"}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {editing &&
                      flow.can_manage &&
                      change.kind === "mr" &&
                      change.status === "selected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRemote({ action: "merge", change })}
                        >
                          <GitMerge />
                          合并
                        </Button>
                      )}
                    {editing &&
                      flow.can_manage &&
                      !change.reverted_by &&
                      change.status !== "removed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setRemote({ action: "create-revert", change })
                          }
                        >
                          <RotateCcw />
                          创建回退
                        </Button>
                      )}
                    {editing &&
                      flow.can_manage &&
                      change.status === "selected" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger"
                          onClick={() => setRemove(change)}
                        >
                          <Trash2 />
                          移出
                        </Button>
                      )}
                  </div>
                </td>
              </tr>
            );
          })}
        </SimpleTable>
        {!flow.changes.length && (
          <p className="p-6 text-center text-sm text-muted">
            尚未登记 MR 或直接提交；纯材料发布可以继续。
          </p>
        )}
      </Panel>
      {add && (
        <ChangeEditor {...props} mode={add} onClose={() => setAdd(null)} />
      )}
      {baseline && (
        <BaselineEditor
          {...props}
          repo={baseline}
          onClose={() => setBaseline(null)}
        />
      )}
      {remote && (
        <RemoteAction
          {...props}
          action={remote.action}
          change={remote.change}
          onClose={() => setRemote(null)}
        />
      )}
      {remove && (
        <ConfirmDialog
          open
          danger
          title="移出发布变更"
          description={`${remove.kind === "mr" ? `MR !${remove.ref}` : remove.ref}`}
          confirmLabel="移出变更"
          pending={submission.pending}
          onClose={() => setRemove(null)}
          onConfirm={() =>
            void submission.run(async () => {
              await request(`${base}/remove-change`, {
                method: "POST",
                etag: releaseEtag,
                body: { change_id: remove.id },
              });
              await props.onChanged();
              setRemove(null);
            })
          }
        >
          <ErrorNotice error={submission.error} />
          <p className="text-sm text-muted">
            记录保留为“已移出”，不会删除远端提交或 MR。
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function BaselineEditor(
  props: ReleaseViewProps & { repo: ReleaseRepository; onClose: () => void },
) {
  const [ref, setRef] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  return (
    <Modal
      open
      title="确认仓库基线"
      description={`${props.repo.full_path} · ${props.repo.main_branch}`}
      onClose={props.onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            取消
          </Button>
          <Button
            pending={submission.pending}
            onClick={() =>
              void submission.run(
                async () => {
                  await request(`${releaseBase(props)}/baseline`, {
                    method: "POST",
                    etag: props.releaseEtag,
                    body: { repo_id: props.repo.id, ...(ref ? { ref } : {}) },
                  });
                  await props.onChanged();
                  props.onClose();
                },
                (error) => errors.show(error, ["ref"]),
              )
            }
          >
            读取并确认基线
          </Button>
        </>
      }
    >
      <form
        ref={errors.formRef}
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <ErrorNotice error={errors.error} />
        <Field
          label="自定义 Tag 或完整 SHA（可选）"
          hint="留空使用上次归档基线；首次使用当前主干 SHA"
          error={errors.fields.ref}
        >
          <Input
            name="ref"
            className="mono"
            value={ref}
            onChange={(event) => setRef(event.target.value)}
          />
        </Field>
        <Notice className="mt-4">
          自定义提交必须解析为固定 SHA，且是当前主干的祖先。
        </Notice>
      </form>
    </Modal>
  );
}

function ChangeEditor(
  props: ReleaseViewProps & {
    mode: "mr" | "commit" | "revert";
    onClose: () => void;
  },
) {
  const { mode } = props;
  const [repoId, setRepoId] = useState("");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const [original, setOriginal] = useState("");
  const [options, setOptions] = useState<MergeRequest[]>([]);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [loaded, setLoaded] = useState(false);
  const errors = useFormErrors();
  const submission = useSubmission();
  const base = releaseBase(props);
  async function load(nextPage = page, nextSize = size) {
    if (!repoId) {
      errors.setError("请先选择仓库。");
      return;
    }
    await submission.run(async () => {
      const response = await request<MergeRequest[]>(
        `${base}/mr-options?page=${nextPage}&page_size=${nextSize}`,
        { method: "POST", etag: props.releaseEtag, body: { repo_id: repoId } },
      );
      setOptions(response.data);
      setPage(nextPage);
      setSize(nextSize);
      setLoaded(true);
    });
  }
  async function save(targetRef = ref) {
    const fields: Record<string, string> = {};
    if (!repoId) fields.repo_id = "请选择仓库";
    if (!targetRef) fields.ref = "请输入或选择引用";
    if (mode === "commit" && !note.trim()) fields.note = "补录提交必须填写说明";
    if (mode === "revert" && !original) fields.original_id = "请选择原始变更";
    if (!errors.validate(fields)) return;
    await submission.run(
      async () => {
        await request(
          `${base}/${mode === "mr" ? "select-mr" : mode === "commit" ? "include-commit" : "link-revert"}`,
          {
            method: "POST",
            etag: props.releaseEtag,
            body: {
              repo_id: repoId,
              ref: targetRef,
              ...(mode === "commit" ? { note } : {}),
              ...(mode === "revert" ? { original_id: original } : {}),
            },
          },
        );
        await props.onChanged();
        props.onClose();
      },
      (error) => errors.show(error, ["repo_id", "ref", "note", "original_id"]),
    );
  }
  const title =
    mode === "mr"
      ? "选择或纳入 MR"
      : mode === "commit"
        ? "补录直接提交"
        : "关联已有回退 MR";
  return (
    <Drawer
      open
      wide
      title={title}
      description="查询与写入均使用你在目标连接上的本人首选 GitLab 凭证"
      onClose={props.onClose}
      pending={submission.pending}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            取消
          </Button>
          {mode !== "mr" && (
            <Button pending={submission.pending} onClick={() => void save()}>
              确认
            </Button>
          )}
        </>
      }
    >
      <form
        ref={errors.formRef}
        className="grid gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === "mr") void load();
          else void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <Field label="范围内仓库" required error={errors.fields.repo_id}>
          <Select
            name="repo_id"
            disabled={submission.pending}
            value={repoId}
            onValueChange={(value) => {
              setRepoId(value);
              setOptions([]);
              setPage(1);
              setLoaded(false);
            }}
          >
            <option value="">请选择</option>
            {props.materials.repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.full_path} · {repo.main_branch}
              </option>
            ))}
          </Select>
        </Field>
        {mode === "mr" && (
          <>
            <Button
              variant="outline"
              disabled={!repoId}
              pending={submission.pending}
              onClick={() => void load()}
            >
              加载候选 MR
            </Button>
            <div className="max-h-80 overflow-y-auto rounded-lg border">
              {options.map((mr) => (
                <div
                  key={mr.iid}
                  className="flex items-start gap-3 border-b p-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <strong>
                      !{mr.iid} · {mr.title}
                    </strong>
                    <small className="mono block break-all text-muted">
                      {mr.sha} · {mr.state}
                    </small>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void save(String(mr.iid))}
                  >
                    {mr.state === "merged" ? "纳入已合并 MR" : "选择 MR"}
                  </Button>
                </div>
              ))}
              {!options.length && (
                <p className="p-5 text-center text-sm text-muted">
                  加载后显示候选；也可在下方按 IID 纳入已在外部合并的 MR。
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Field label="MR IID" error={errors.fields.ref}>
                <Input
                  name="ref"
                  inputMode="numeric"
                  value={ref}
                  onChange={(event) => setRef(event.target.value)}
                />
              </Field>
              <Button
                className="mt-6"
                variant="outline"
                onClick={() => void save()}
              >
                按 IID 纳入
              </Button>
            </div>
            {loaded && (
              <Pagination
                page={page}
                size={size}
                hasNext={options.length === size}
                pending={submission.pending}
                onChange={(nextPage, nextSize) => void load(nextPage, nextSize)}
              />
            )}
          </>
        )}
        {mode === "commit" && (
          <>
            <Field label="完整提交 SHA" required error={errors.fields.ref}>
              <Input
                name="ref"
                className="mono"
                value={ref}
                onChange={(event) => setRef(event.target.value)}
              />
            </Field>
            <Field label="补录说明" required error={errors.fields.note}>
              <Textarea
                name="note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </>
        )}
        {mode === "revert" && (
          <>
            <Field label="原始变更" required error={errors.fields.original_id}>
              <Select
                name="original_id"
                value={original}
                onValueChange={(value) => setOriginal(value)}
              >
                <option value="">请选择同仓库原始变更</option>
                {props.flow.changes
                  .filter(
                    (change) =>
                      change.repo_id === repoId && change.status !== "removed",
                  )
                  .map((change) => (
                    <option key={change.id} value={change.id}>
                      {change.kind === "mr" ? `MR !${change.ref}` : change.ref}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="回退 MR IID" required error={errors.fields.ref}>
              <Input
                name="ref"
                inputMode="numeric"
                value={ref}
                onChange={(event) => setRef(event.target.value)}
              />
            </Field>
          </>
        )}
      </form>
    </Drawer>
  );
}

function RemoteAction(
  props: ReleaseViewProps & {
    action: "merge" | "create-revert";
    change: ReleaseChange;
    onClose: () => void;
  },
) {
  const [identity, setIdentity] = useState<{
    identity: string;
    token: string;
  } | null>(null);
  const [result, setResult] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  const base = releaseBase(props);
  const sha =
    props.action === "merge"
      ? evidenceString(props.change, "sha")
      : evidenceString(props.change, "merge_commit_sha") ||
        evidenceString(props.change, "squash_commit_sha") ||
        (evidenceString(props.change, "state") === "merged"
          ? evidenceString(props.change, "sha")
          : "") ||
        (props.change.kind === "commit" ? props.change.ref : "");
  async function identify() {
    await submission.run(async () => {
      const response = await request<{ identity: string; token: string }>(
        `${base}/git-identity`,
        {
          method: "POST",
          etag: props.releaseEtag,
          body: { repo_id: props.change.repo_id },
        },
      );
      setIdentity(response.data);
    });
  }
  async function execute() {
    if (!identity) return;
    await submission.run(
      async () => {
        const response = await request<{ id?: string; status?: string }>(
          `${base}/${props.action}`,
          {
            method: "POST",
            etag: props.releaseEtag,
            idempotencyKey: uuid(),
            body: {
              change_id: props.change.id,
              sha,
              actor_token: identity.token,
            },
          },
        );
        setResult(response.data.status ?? "succeeded");
        await props.onChanged();
      },
      (error) => {
        errors.show(error, ["sha"]);
        if (isUncertain(error)) setResult("unknown");
      },
    );
  }
  return (
    <Modal
      open
      title={props.action === "merge" ? "确认合并 MR" : "确认创建回退 MR"}
      description={
        props.change.kind === "mr"
          ? `MR !${props.change.ref}`
          : props.change.ref
      }
      pending={submission.pending}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            关闭
          </Button>
          {!result &&
            (identity ? (
              <Button
                pending={submission.pending}
                disabled={!sha}
                onClick={() => void execute()}
              >
                确认执行远端操作
              </Button>
            ) : (
              <Button
                pending={submission.pending}
                onClick={() => void identify()}
              >
                读取本人 GitLab 身份
              </Button>
            ))}
        </>
      }
    >
      <ErrorNotice error={errors.error} />
      <ErrorNotice error={submission.error} />
      {result ? (
        <Notice
          tone={
            result === "succeeded"
              ? "success"
              : result === "unknown"
                ? "warning"
                : "danger"
          }
        >
          {result === "succeeded"
            ? "远端操作已完成并记录。"
            : result === "unknown"
              ? "请求结果未知，请到操作记录只读核实，不要重新发送。"
              : `远端操作状态：${result}`}
        </Notice>
      ) : (
        <>
          <Notice tone="warning">
            目标提交：
            <code className="mono break-all">
              {sha || "缺少已确认 SHA，无法执行"}
            </code>
            。操作使用当前账号在目标连接上的个人首选凭证。
          </Notice>
          {identity && (
            <p className="mt-4 text-sm">远端身份：{identity.identity}</p>
          )}
        </>
      )}
    </Modal>
  );
}
