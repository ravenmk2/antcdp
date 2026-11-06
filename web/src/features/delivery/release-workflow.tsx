import { useState } from "react";
import {
  Archive,
  ArrowRight,
  Check,
  Download,
  Eye,
  Lock,
  RotateCcw,
  StopCircle,
} from "lucide-react";
import { isUncertain, request } from "@/api/client";
import { Button } from "@/components/button";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { Field, Textarea } from "@/components/fields";
import { DescriptionList, Panel } from "@/components/layout";
import { ConfirmDialog, Drawer, Modal } from "@/components/overlays";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import {
  deliveryLabel,
  reasonLabel,
  releaseStatus,
  resultTone,
} from "@/domain/labels";
import { canTerminateRelease, reviewNeedsNote } from "@/domain/delivery-rules";
import { formatDate, jsonText, uuid } from "@/lib/utils";
import type { Manifest, ReleaseOperation } from "@/types/delivery";
import { releaseBase, type ReleaseViewProps } from "./release-types";

interface StageProps extends ReleaseViewProps {
  view: "stage" | "manifests" | "operations";
}

export function ReleaseWorkflow(props: StageProps) {
  if (props.view === "manifests") return <Manifests {...props} />;
  if (props.view === "operations") return <Operations {...props} />;
  return <StagePanel {...props} />;
}

function StagePanel(props: StageProps) {
  const { release, flow } = props;
  const [action, setAction] = useState<
    "start" | "freeze" | "review" | "return" | "archive" | "terminate" | null
  >(null);
  const current =
    flow.manifests.find(
      (manifest) => manifest.id === release.current_manifest_id,
    ) ?? flow.manifests[0];
  const latest = flow.operations[0];
  const description: Record<string, string> = {
    draft: "确认完整仓库范围与基线后开始发布。",
    integrating: "核对变更与材料，冻结后生成当前送验清单。",
    reviewing: "验收只针对当前 manifest_id 与摘要。",
    accepted: "验收已通过，可开始逐仓 Tag 与归档。",
    tagging: "逐仓核实 Tag；部分成功与未知结果分别记录。",
    archived: "发布已归档，冻结内容保持只读。",
    terminated: "发布已终止，历史事实保持可查。",
  };
  return (
    <div className="grid gap-4">
      <Panel title="当前阶段">
        <StatusBadge tone={resultTone(release.status)}>
          {releaseStatus(release.status)}
        </StatusBadge>
        <p className="mt-3 text-sm leading-6 text-muted">
          {description[release.status]}
        </p>
        <div className="mt-5 grid gap-2">
          {release.needs_attention && (
            <Notice tone="warning">
              存在仍占活动槽的未知远端操作。请先核实，不要重发。
            </Notice>
          )}
          {release.status === "draft" && (
            <Button
              disabled={!flow.can_manage}
              onClick={() => setAction("start")}
            >
              确认范围并开始 <ArrowRight />
            </Button>
          )}
          {release.status === "integrating" && (
            <Button
              disabled={!flow.can_manage}
              onClick={() => setAction("freeze")}
            >
              <Lock />
              核对并冻结送验
            </Button>
          )}
          {release.status === "reviewing" && (
            <Button
              disabled={!flow.can_manage || !current}
              onClick={() => setAction("review")}
            >
              <Check />
              记录验收结论
            </Button>
          )}
          {["accepted", "tagging"].includes(release.status) && (
            <Button
              disabled={
                !flow.can_manage || !current || latest?.status === "unknown"
              }
              onClick={() => setAction("archive")}
            >
              <Archive />
              {release.status === "tagging"
                ? "补做缺失 Tag 并归档"
                : "打 Tag 并归档"}
            </Button>
          )}
          {release.status === "accepted" && (
            <Button
              variant="outline"
              disabled={!flow.can_manage || !current}
              onClick={() => setAction("return")}
            >
              <RotateCcw />
              撤销验收并退回
            </Button>
          )}
          {canTerminateRelease(release.status, latest?.status) && (
            <Button
              variant="ghost"
              className="text-danger"
              disabled={!flow.can_manage}
              onClick={() => setAction("terminate")}
            >
              <StopCircle />
              终止发布
            </Button>
          )}
        </div>
      </Panel>
      <Panel title="发布信息">
        <DescriptionList
          items={[
            {
              label: "完整 Tag",
              value: <span className="mono">{release.tag_name}</span>,
              full: true,
            },
            {
              label: "范围仓库",
              value: `${props.materials.repositories.length} 个`,
            },
            {
              label: "有效变更",
              value: `${flow.changes.filter((change) => change.status !== "removed").length} 项`,
            },
            { label: "材料", value: `${props.materials.items.length} 项` },
            {
              label: "当前清单",
              value: current ? `Manifest #${current.sequence_no}` : "尚未生成",
            },
            {
              label: "清单摘要",
              value: current ? (
                <span className="mono break-all">{current.digest}</span>
              ) : (
                "—"
              ),
              full: true,
            },
          ]}
        />
        {current && (
          <Button asChild variant="outline" className="mt-4 w-full">
            <a
              href={`/api/v1${releaseBase(props)}/manifests/${current.id}/download`}
            >
              <Download />
              下载当前清单 ZIP
            </a>
          </Button>
        )}
      </Panel>
      {action === "start" && (
        <StartRelease {...props} onClose={() => setAction(null)} />
      )}
      {action === "freeze" && (
        <FreezeRelease {...props} onClose={() => setAction(null)} />
      )}
      {(action === "review" || action === "return") && current && (
        <ReviewRelease
          {...props}
          manifest={current}
          revoke={action === "return"}
          onClose={() => setAction(null)}
        />
      )}
      {action === "archive" && current && (
        <ArchiveRelease
          {...props}
          manifest={current}
          onClose={() => setAction(null)}
        />
      )}
      {action === "terminate" && (
        <TerminateRelease {...props} onClose={() => setAction(null)} />
      )}
    </div>
  );
}

function StartRelease(props: ReleaseViewProps & { onClose: () => void }) {
  const [preview, setPreview] = useState<{
    adds: string[];
    drops: string[];
    token: string;
  } | null>(null);
  const submission = useSubmission();
  async function load() {
    await submission.run(async () => {
      const response = await request<{
        adds: string[];
        drops: string[];
        token: string;
      }>(`${releaseBase(props)}/scope-preview`, {
        method: "POST",
        etag: props.releaseEtag,
        body: {},
      });
      setPreview(response.data);
    });
  }
  return (
    <Modal
      open
      title="确认范围并开始发布"
      description={`${props.release.name || props.release.version_label} · 将固定当前产品分支范围`}
      pending={submission.pending}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            取消
          </Button>
          {preview ? (
            <Button
              pending={submission.pending}
              onClick={() =>
                void submission.run(async () => {
                  await request(`${releaseBase(props)}/start`, {
                    method: "POST",
                    etag: props.releaseEtag,
                    body: { digest: preview.token },
                  });
                  await props.onChanged();
                  props.onClose();
                })
              }
            >
              确认范围并开始
            </Button>
          ) : (
            <Button pending={submission.pending} onClick={() => void load()}>
              <Eye />
              读取范围预览
            </Button>
          )}
        </>
      }
    >
      <ErrorNotice error={submission.error} />
      {preview ? (
        <Notice tone={preview.drops.length ? "warning" : "info"}>
          <strong>
            新增 {preview.adds.length} · 移出 {preview.drops.length}
          </strong>
          {[...preview.adds, ...preview.drops].map((item) => (
            <div key={item} className="mono break-all text-xs">
              {item}
            </div>
          ))}
          <p className="mt-2">
            所有范围仓库必须有基线；开始后将占用对应远端仓库与主干。
          </p>
        </Notice>
      ) : (
        <Notice>先读取范围增减与最新基线，确认后才会改变发布阶段。</Notice>
      )}
    </Modal>
  );
}

interface FreezePreview {
  repositories: {
    id: string;
    full_path: string;
    main_branch: string;
    baseline_sha: string;
    commit_sha: string;
    observed_at: string;
    extra: { id: string }[];
    problems: string[];
  }[];
  problems: string[];
  preview_token: string;
}
function FreezeRelease(props: ReleaseViewProps & { onClose: () => void }) {
  const [preview, setPreview] = useState<FreezePreview | null>(null);
  const [unknown, setUnknown] = useState(false);
  const submission = useSubmission();
  async function load() {
    await submission.run(async () => {
      const response = await request<FreezePreview>(
        `${releaseBase(props)}/freeze-preview`,
        { method: "POST", etag: props.releaseEtag, body: {} },
      );
      setPreview(response.data);
    });
  }
  const blockers =
    (preview?.problems.length ?? 0) +
    (preview?.repositories.reduce(
      (count, repo) => count + repo.problems.length + repo.extra.length,
      0,
    ) ?? 0);
  return (
    <Drawer
      open
      wide
      title="冻结并送验"
      description="先核对当前候选 SHA、额外提交与配置冲突，再生成不可变清单"
      pending={submission.pending}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            关闭
          </Button>
          {preview ? (
            <Button
              pending={submission.pending}
              disabled={blockers > 0 || unknown}
              onClick={() =>
                void submission.run(async () => {
                  try {
                    await request(`${releaseBase(props)}/freeze`, {
                      method: "POST",
                      etag: props.releaseEtag,
                      body: { digest: preview.preview_token },
                    });
                    await props.onChanged();
                    props.onClose();
                  } catch (error) {
                    if (isUncertain(error)) setUnknown(true);
                    throw error;
                  }
                })
              }
            >
              <Lock />
              确认冻结并送验
            </Button>
          ) : (
            <Button pending={submission.pending} onClick={() => void load()}>
              <Eye />
              生成核对预览
            </Button>
          )}
        </>
      }
    >
      <ErrorNotice error={submission.error} />
      {unknown && (
        <Notice tone="warning" className="mb-4">
          冻结结果未知。请关闭后读取发布与送验清单，不要直接使用旧预览重试。
        </Notice>
      )}
      {!preview ? (
        <Notice>预览会读取远端主干并比较基线；不会冻结或修改发布。</Notice>
      ) : (
        <div className="grid gap-4">
          {preview.problems.map((problem) => (
            <Notice key={problem} tone="danger">
              {problem}
            </Notice>
          ))}
          {preview.repositories.map((repo) => (
            <section key={repo.id} className="rounded-lg border p-4">
              <strong className="mono break-all text-xs">
                {repo.full_path}
              </strong>
              <div className="mt-2 grid gap-1 text-xs">
                <span>
                  基线 <code>{repo.baseline_sha}</code>
                </span>
                <span>
                  候选 <code>{repo.commit_sha}</code>
                </span>
                <span className="text-muted">
                  观测 {formatDate(repo.observed_at)}
                </span>
              </div>
              {repo.problems.map((problem) => (
                <Notice key={problem} tone="danger" className="mt-2">
                  {problem}
                </Notice>
              ))}
              {repo.extra.length > 0 && (
                <Notice tone="warning" className="mt-2">
                  存在 {repo.extra.length}{" "}
                  个未归属额外提交，请返回本次变更补录或关联回退。
                </Notice>
              )}
            </section>
          ))}
          {blockers === 0 && (
            <Notice tone="success">
              未发现待处理问题；冻结仍需重新读取各仓 HEAD 并核对发布版本。
            </Notice>
          )}
        </div>
      )}
    </Drawer>
  );
}

function ReviewRelease(
  props: ReleaseViewProps & {
    manifest: Manifest;
    revoke: boolean;
    onClose: () => void;
  },
) {
  const [decision, setDecision] = useState<"pass" | "return">(
    props.revoke ? "return" : "pass",
  );
  const [note, setNote] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  async function save() {
    if (reviewNeedsNote(decision) && !note.trim()) {
      errors.validate({ note: "退回必须填写原因" });
      return;
    }
    await submission.run(
      async () => {
        await request(
          `${releaseBase(props)}/${props.revoke ? "return" : "review"}`,
          {
            method: "POST",
            etag: props.releaseEtag,
            body: {
              manifest_id: props.manifest.id,
              digest: props.manifest.digest,
              decision,
              note,
            },
          },
        );
        await props.onChanged();
        props.onClose();
      },
      (error) => errors.show(error, ["note", "manifest_id", "digest"]),
    );
  }
  return (
    <Modal
      open
      title={props.revoke ? "撤销验收并退回" : "记录验收结论"}
      description={`Manifest #${props.manifest.sequence_no} · ${props.manifest.digest}`}
      pending={submission.pending}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            取消
          </Button>
          <Button pending={submission.pending} onClick={() => void save()}>
            {decision === "pass" ? "验收通过" : "确认退回"}
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
        {!props.revoke && (
          <Field label="验收结论">
            <SelectDecision value={decision} onChange={setDecision} />
          </Field>
        )}
        <Field
          label={reviewNeedsNote(decision) ? "退回原因" : "验收说明"}
          required={reviewNeedsNote(decision)}
          error={errors.fields.note}
        >
          <Textarea
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <Notice>操作绑定当前清单 ID 与摘要；旧送验版不会被修改。</Notice>
      </form>
    </Modal>
  );
}
function SelectDecision({
  value,
  onChange,
}: {
  value: "pass" | "return";
  onChange: (value: "pass" | "return") => void;
}) {
  return (
    <select
      className="min-h-10 w-full rounded-lg border bg-surface px-3"
      value={value}
      onChange={(event) => onChange(event.target.value as "pass" | "return")}
    >
      <option value="pass">验收通过</option>
      <option value="return">退回备料</option>
    </select>
  );
}

function TerminateRelease(props: ReleaseViewProps & { onClose: () => void }) {
  const [note, setNote] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();
  return (
    <ConfirmDialog
      open
      danger
      title="终止发布"
      description="终止不会自动回退提交或删除 Tag"
      confirmLabel="确认终止发布"
      pending={submission.pending}
      onClose={props.onClose}
      onConfirm={() => {
        if (!note.trim()) {
          errors.validate({ note: "终止必须填写原因与残留处置说明" });
          return;
        }
        void submission.run(async () => {
          await request(`${releaseBase(props)}/terminate`, {
            method: "POST",
            etag: props.releaseEtag,
            body: { note },
          });
          await props.onChanged();
          props.onClose();
        });
      }}
    >
      <form ref={errors.formRef}>
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        <Field label="终止原因与残留处置" required error={errors.fields.note}>
          <Textarea
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </form>
    </ConfirmDialog>
  );
}

function ArchiveRelease(
  props: ReleaseViewProps & { manifest: Manifest; onClose: () => void },
) {
  const [identity, setIdentity] = useState<{
    identity: string;
    token: string;
  } | null>(null);
  const [result, setResult] = useState("");
  const submission = useSubmission();
  async function identify() {
    await submission.run(async () => {
      const response = await request<{ identity: string; token: string }>(
        `${releaseBase(props)}/git-identity`,
        { method: "POST", etag: props.releaseEtag, body: {} },
      );
      setIdentity(response.data);
    });
  }
  async function execute() {
    if (!identity) return;
    await submission.run(async () => {
      try {
        const response = await request<{ status?: string }>(
          `${releaseBase(props)}/archive`,
          {
            method: "POST",
            etag: props.releaseEtag,
            idempotencyKey: uuid(),
            body: {
              manifest_id: props.manifest.id,
              digest: props.manifest.digest,
              actor_token: identity.token,
            },
          },
        );
        setResult(response.data.status ?? "succeeded");
        await props.onChanged();
      } catch (error) {
        if (isUncertain(error)) setResult("unknown");
        throw error;
      }
    });
  }
  return (
    <Modal
      open
      title="打 Tag 并归档"
      description={`Manifest #${props.manifest.sequence_no} · ${props.release.tag_name}`}
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
                onClick={() => void execute()}
              >
                确认逐仓打 Tag
              </Button>
            ) : (
              <Button
                pending={submission.pending}
                onClick={() => void identify()}
              >
                核对本人远端身份
              </Button>
            ))}
        </>
      }
    >
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
            ? "全部 Tag 已核实，发布已归档。"
            : result === "unknown"
              ? "结果未知，请进入操作记录逐仓核实，不要重发。"
              : `部分操作未完成：${result}。可在归档中状态补做缺失项。`}
        </Notice>
      ) : (
        <>
          <Notice tone="warning">
            Tag 只指向当前冻结清单中的 SHA；同名异 SHA
            会阻止，不会覆盖。多仓操作不提供分布式回滚。
          </Notice>
          {identity && (
            <p className="mt-4 break-all text-sm">
              远端身份：{identity.identity}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function Manifests(props: StageProps) {
  const [selected, setSelected] = useState<Manifest | null>(null);
  const currentId = props.release.current_manifest_id;
  return (
    <Panel title="送验清单与验收记录">
      <Notice className="mb-4">
        当前草稿、当前验收版与历史送验版分别保留；每次退回后再次送验会生成新清单。
      </Notice>
      <SimpleTable
        label="送验清单"
        headers={["清单", "摘要", "冻结时间", "验收结论", "说明", "操作"]}
      >
        {props.flow.manifests.map((manifest) => (
          <tr key={manifest.id}>
            <td>
              <strong>Manifest #{manifest.sequence_no}</strong>
              {manifest.id === currentId && (
                <StatusBadge tone="info">当前</StatusBadge>
              )}
            </td>
            <td className="mono break-all text-xs">{manifest.digest}</td>
            <td className="text-xs text-muted">
              {formatDate(manifest.created_at)}
            </td>
            <td>
              <StatusBadge
                tone={
                  manifest.decision === "pass"
                    ? "success"
                    : manifest.decision === "return"
                      ? "warning"
                      : "neutral"
                }
              >
                {manifest.decision === "pass"
                  ? "通过"
                  : manifest.decision === "return"
                    ? "已退回"
                    : "待验收"}
              </StatusBadge>
            </td>
            <td className="max-w-sm whitespace-normal text-xs">
              {manifest.review_note || "—"}
            </td>
            <td>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(manifest)}
                >
                  详情
                </Button>
                <a
                  className="link p-2"
                  aria-label={`下载 Manifest ${manifest.sequence_no}`}
                  href={`/api/v1${releaseBase(props)}/manifests/${manifest.id}/download`}
                >
                  <Download className="size-4" />
                </a>
              </div>
            </td>
          </tr>
        ))}
      </SimpleTable>
      {!props.flow.manifests.length && (
        <p className="p-8 text-center text-sm text-muted">尚未冻结送验清单。</p>
      )}
      {selected && (
        <ManifestDetail
          {...props}
          manifest={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </Panel>
  );
}

function ManifestDetail(
  props: StageProps & { manifest: Manifest; onClose: () => void },
) {
  const query = useApiQuery<{
    manifest: Manifest;
    entries: {
      kind: string;
      subject_id: string;
      revision_id?: string;
      sort_order: number;
      snapshot: Record<string, unknown>;
    }[];
  }>(
    ["manifest", props.release.id, props.manifest.id],
    `${releaseBase(props)}/manifests/${props.manifest.id}`,
  );
  return (
    <Drawer
      open
      wide
      title={`Manifest #${props.manifest.sequence_no}`}
      description={`${props.manifest.digest} · ${formatDate(props.manifest.created_at)}`}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="outline" onClick={props.onClose}>
            关闭
          </Button>
          <Button asChild>
            <a
              href={`/api/v1${releaseBase(props)}/manifests/${props.manifest.id}/download`}
            >
              <Download />
              下载 ZIP
            </a>
          </Button>
        </>
      }
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <div className="grid gap-3">
            <DescriptionList
              items={[
                {
                  label: "验收结论",
                  value: props.manifest.decision || "待验收",
                },
                {
                  label: "验收时间",
                  value: formatDate(props.manifest.reviewed_at),
                },
                {
                  label: "验收说明",
                  value: props.manifest.review_note || "—",
                  full: true,
                },
              ]}
            />
            {query.data.data.entries.map((entry, index) => (
              <details
                key={`${entry.kind}-${entry.subject_id}-${index}`}
                className="rounded-lg border p-3"
              >
                <summary className="cursor-pointer text-sm font-medium">
                  {entry.kind} · {entry.subject_id}
                  {entry.revision_id ? ` · ${entry.revision_id}` : ""}
                </summary>
                <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-surface-subtle p-3 text-xs">
                  {jsonText(entry.snapshot)}
                </pre>
              </details>
            ))}
          </div>
        )}
      </AsyncBoundary>
    </Drawer>
  );
}

function Operations(props: StageProps) {
  const [selected, setSelected] = useState<ReleaseOperation | null>(null);
  const [result, setResult] = useState("");
  const submission = useSubmission();
  const latest = props.flow.operations[0];
  async function reconcile(operation: ReleaseOperation) {
    await submission.run(async () => {
      const response = await request<{ status?: string }>(
        `${releaseBase(props)}/reconcile`,
        {
          method: "POST",
          etag: props.releaseEtag,
          body: { operation_id: operation.id },
        },
      );
      setResult(response.data.status ?? "unknown");
      await props.onChanged();
    });
  }
  return (
    <Panel title="远端操作与结果核实">
      <ErrorNotice error={submission.error} />
      {result && (
        <Notice
          tone={result === "succeeded" ? "success" : "warning"}
          className="mb-4"
        >
          核实结果：{deliveryLabel(result)}。请查看逐项事实。
        </Notice>
      )}
      <Notice className="mb-4">
        只读核实不会创建分支、合并 MR 或补写
        Tag；已确认失败的步骤才可由新的明确命令重试。
      </Notice>
      <SimpleTable
        label="发布操作记录"
        headers={["操作", "状态", "时间", "操作者", "操作"]}
      >
        {props.flow.operations.map((operation) => (
          <tr key={operation.id}>
            <td>
              <strong>{deliveryLabel(operation.kind)}</strong>
              <small className="mono block text-muted">{operation.id}</small>
            </td>
            <td>
              <StatusBadge tone={resultTone(operation.status)}>
                {deliveryLabel(operation.status)}
              </StatusBadge>
            </td>
            <td className="text-xs text-muted">
              {formatDate(operation.created_at)}
            </td>
            <td className="mono">{operation.actor_id}</td>
            <td>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelected(operation)}
                >
                  详情
                </Button>
                {latest?.id === operation.id &&
                  ["running", "unknown"].includes(operation.status) &&
                  props.flow.can_manage && (
                    <Button
                      size="sm"
                      pending={submission.pending}
                      onClick={() => void reconcile(operation)}
                    >
                      只读核实
                    </Button>
                  )}
              </div>
            </td>
          </tr>
        ))}
      </SimpleTable>
      {!props.flow.operations.length && (
        <p className="p-8 text-center text-sm text-muted">尚无远端操作。</p>
      )}
      {selected && (
        <Modal
          open
          wide
          title={`操作 ${selected.id}`}
          description={deliveryLabel(selected.kind)}
          onClose={() => setSelected(null)}
          footer={<Button onClick={() => setSelected(null)}>关闭</Button>}
        >
          {latest?.id === selected.id ? (
            <SimpleTable
              label="操作步骤"
              headers={["步骤", "仓库", "状态", "观测结果"]}
            >
              {props.flow.steps.map((step) => {
                const repo = props.materials.repositories.find(
                  (item) => item.id === step.repo_id,
                );
                return (
                  <tr key={step.id}>
                    <td>{deliveryLabel(step.kind)}</td>
                    <td className="mono break-all text-xs">
                      {repo?.full_path ?? step.repo_id}
                    </td>
                    <td>
                      <StatusBadge tone={resultTone(step.status)}>
                        {deliveryLabel(step.status)}
                      </StatusBadge>
                    </td>
                    <td className="max-w-md whitespace-normal text-xs">
                      {step.observed?.reason
                        ? reasonLabel(step.observed.reason)
                        : jsonText(step.observed)}
                    </td>
                  </tr>
                );
              })}
            </SimpleTable>
          ) : (
            <Notice>
              历史操作摘要已保留；当前工作流响应只包含最近一次操作的步骤。
            </Notice>
          )}
        </Modal>
      )}
    </Panel>
  );
}
