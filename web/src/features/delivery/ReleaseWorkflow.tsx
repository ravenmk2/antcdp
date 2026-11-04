import { FlowDrawer } from "./ReleaseFlowDrawer";
import { actions, type Flow, type Command } from "./releases";
import { ReleaseRepositories } from "./ReleaseRepositories";
import { FrozenDetails } from "./FrozenDetails";
import {
  ReleaseCheckResult,
  checkProblemCount,
  type ReleaseCheck,
} from "./ReleaseCheckResult";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Download,
  MoreHorizontal,
  GitPullRequest,
  Files,
  FileText,
  ClipboardCheck,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRevalidator, Link, useLocation, useNavigate } from "react-router";
import { request, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/platform/feedback";
import type { MaterialSet, Release } from "./releases";
import { releaseStatusLabels } from "./release-labels";
const stages: Record<string, string> = {
  draft: "确认仓库范围与基线后开始发布。",
  integrating: "准备本次变更与交付材料，核对范围内的主干后冻结送验。",
  reviewing: "按本次冻结清单验收，退回后可形成新的送验版本。",
  accepted: "验收已通过，按冻结的主干提交打 Tag。",
  tagging: "逐仓核实 Tag，全部一致后归档。",
  archived: "已归档，可下载冻结清单。",
  terminated: "发布已终止，已保存的材料与操作记录可查阅。",
};
const state: Record<string, string> = {
  pending: "未开始",
  running: "执行中",
  failed: "失败",
  succeeded: "已核实",
  unknown: "结果未知",
  selected: "已选",
  included: "已纳入",
  reverted: "已回退",
  revert_pending: "待回退",
  removed: "已移出",
};
export function ReleaseWorkflow({
  path,
  release: r,
  flow,
  set,
  notes,
  materials,
  readOnlyReason,
  scopeHelp,
}: {
  path: string;
  release: Release;
  flow: Flow;
  set: MaterialSet;
  notes: ReactNode;
  materials: ReactNode;
  readOnlyReason?: string;
  scopeHelp?: ReactNode;
}) {
  const rv = useRevalidator(),
    [task, choose] = useState<Command>(),
    [preview, setPreview] = useState<{
      data: ReleaseCheck;
      etag: string;
      path: string;
    }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const active = flow.operations[0],
    working = active && ["running", "unknown"].includes(active.status);
  const m = flow.manifests[0],
    manage = flow.can_manage && !readOnlyReason,
    draft = r.status === "draft",
    integrating = r.status === "integrating";
  const location = useLocation(),
    navigate = useNavigate();
  const sections = [
    ["repos", "本次变更", GitPullRequest],
    ["materials", "交付材料", Files],
    ["notes", "发布说明", FileText],
    ["history", "验收与归档", ClipboardCheck],
  ] as const;
  const hash = location.hash.slice(1);
  const section =
    hash === "scope"
      ? "repos"
      : sections.some(([key]) => key === hash)
        ? hash
        : ["draft", "integrating"].includes(r.status)
          ? "repos"
          : "history";
  const [progressOpen, showProgress] = useState(false);
  const previewBox = useRef<HTMLElement>(null);
  useEffect(() => {
    if (preview) previewBox.current?.focus();
  }, [preview]);
  const phases = ["确认范围与基线", "合并与备料", "冻结验收", "打 Tag 归档"];
  const phaseIndex = ["draft", "integrating", "reviewing"].indexOf(r.status);
  const current =
    r.status === "terminated"
      ? -1
      : r.status === "archived"
        ? 4
        : phaseIndex < 0
          ? 3
          : phaseIndex;
  async function inspect() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setPreview(undefined);
    if (section !== "repos")
      void navigate({ search: location.search, hash: "#repos" });
    try {
      const result = await request<ReleaseCheck>(path + "/freeze-preview", {
        method: "POST",
        etag: r.etag,
        body: {},
      });
      setPreview({ data: result.data, etag: r.etag, path });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const currentPreview =
    preview?.etag === r.etag && preview.path === path
      ? preview.data
      : undefined;
  const blocked =
    !currentPreview ||
    !currentPreview.preview_token ||
    checkProblemCount(currentPreview) > 0;
  const missingBaselines = set.repositories.filter(
    (repo) => !repo.baseline_sha,
  ).length;
  const pending = busy || rv.state !== "idle";
  const act = (op: string, more: Partial<Command> = {}) => {
    if (
      pending ||
      (working && op !== "reconcile") ||
      (op === "freeze" && blocked)
    )
      return;
    choose({ op, ...more });
  };
  const done = () => {
    choose(undefined);
    setPreview(undefined);
    void rv.revalidate();
  };
  return (
    <div className="release-layout">
      <aside className="release-side" aria-label="发布进度与操作">
        <div className="release-side-heading">
          <div>
            <p className="release-stage-label">当前阶段</p>
            <h2>{releaseStatusLabels[r.status] || r.status}</h2>
          </div>
          {current >= 0 && (
            <button
              className="release-progress-toggle"
              aria-controls="release-progress"
              aria-expanded={progressOpen}
              onClick={() => showProgress(!progressOpen)}
            >
              {progressOpen ? "收起进度" : "查看进度"}
            </button>
          )}
          {manage &&
            !working &&
            !["archived", "terminated"].includes(r.status) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label="更多发布操作"
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {r.status === "accepted" && (
                    <DropdownMenuItem onSelect={() => act("return")}>
                      撤销验收
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => act("terminate")}
                  >
                    终止发布
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
        </div>
        <p className="release-stage-message" role="status">
          {readOnlyReason ||
            (working
              ? active.status === "unknown"
                ? "远端结果待核实，请先核实后再继续。"
                : "Git 操作执行中，请等待结果。"
              : stages[r.status])}
        </p>
        {active?.status === "failed" && (
          <p className="release-empty-copy">
            最近一次操作未完成，请查看操作记录。
          </p>
        )}
        {!readOnlyReason &&
          draft &&
          (!set.repositories.length || missingBaselines > 0) && (
            <div className="release-readiness" role="status">
              <strong>
                {!set.repositories.length
                  ? "尚未确定发布范围"
                  : `${missingBaselines} 个仓库待确认基线`}
              </strong>
              {!set.repositories.length && scopeHelp ? (
                scopeHelp
              ) : (
                <p>
                  范围共 {set.repositories.length}{" "}
                  个仓库。请在下方范围与基线中逐仓确认；不要求每个仓库都有 MR。
                </p>
              )}
              <Link
                to={{ search: location.search, hash: "#scope" }}
                preventScrollReset
              >
                查看范围与基线 →
              </Link>
            </div>
          )}
        {integrating && preview && (
          <p className="release-check-status" role="status">
            {!currentPreview
              ? "核对结果已过期，请重新核对。"
              : blocked
                ? checkProblemCount(currentPreview)
                  ? `${checkProblemCount(currentPreview)} 项待处理，完成后重新核对。`
                  : "核对尚未完成，请重新核对。"
                : manage && !working
                  ? "核对通过，可以冻结并送验。"
                  : "核对通过，可查看核对清单。"}
          </p>
        )}
        <div className="release-main-actions">
          {working && manage ? (
            <Button disabled={pending} onClick={() => act("reconcile")}>
              核实远端结果
            </Button>
          ) : (
            manage && (
              <>
                {draft && (
                  <>
                    <Button
                      disabled={
                        !set.repositories.length ||
                        missingBaselines > 0 ||
                        pending
                      }
                      onClick={() => act("start")}
                    >
                      确认范围并开始
                    </Button>
                  </>
                )}
                {integrating && (
                  <>
                    {currentPreview && !blocked && (
                      <Button disabled={pending} onClick={() => act("freeze")}>
                        冻结并送验
                      </Button>
                    )}
                    <Button
                      variant={
                        currentPreview && !blocked ? "outline" : "default"
                      }
                      disabled={pending}
                      onClick={() => void inspect()}
                    >
                      {busy
                        ? "正在核对…"
                        : preview
                          ? "重新核对版本与材料"
                          : "核对版本与材料"}
                    </Button>
                  </>
                )}
                {r.status === "reviewing" && (
                  <>
                    <Button
                      disabled={pending}
                      onClick={() => act("review", { decision: "pass" })}
                    >
                      验收通过
                    </Button>
                    <Button
                      variant="outline"
                      disabled={pending}
                      onClick={() => act("review", { decision: "return" })}
                    >
                      退回修改
                    </Button>
                  </>
                )}
                {["accepted", "tagging"].includes(r.status) && (
                  <Button disabled={pending} onClick={() => act("archive")}>
                    打 Tag 并归档
                  </Button>
                )}
              </>
            )
          )}
        </div>
        {current >= 0 && (
          <div
            id="release-progress"
            data-expanded={progressOpen}
            className="release-progress"
          >
            <h3>本次发布进度</h3>
            <ol>
              {phases.map((name, i) => (
                <li
                  key={name}
                  data-step={
                    i < current ? "done" : i === current ? "current" : "later"
                  }
                  aria-current={i === current ? "step" : undefined}
                >
                  <span className="release-step-dot">
                    {i < current ? <Check /> : i + 1}
                  </span>
                  <span>
                    {name}
                    {i === 2 && m && <small>清单 #{m.sequence_no}</small>}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {m && (
          <div className="release-side-download">
            <Button asChild variant="outline" size="sm">
              <a
                href={"/api/v1" + path + "/manifests/" + m.id + "/download"}
                download
              >
                <Download />
                下载清单 #{m.sequence_no} ZIP
              </a>
            </Button>
          </div>
        )}
      </aside>
      <section className="release-content release-surface">
        <nav className="release-tabs" aria-label="发布详情">
          {sections.map(([key, name, Icon]) => (
            <Link
              key={key}
              to={{ search: location.search, hash: "#" + key }}
              preventScrollReset
              aria-current={section === key ? "page" : undefined}
            >
              <Icon aria-hidden="true" />
              {name}
            </Link>
          ))}
        </nav>
        <div className="release-pane">
          {error && <ErrorBox>{error}</ErrorBox>}
          {section === "notes" ? (
            notes
          ) : section === "materials" ? (
            materials
          ) : section === "history" ? (
            <>
              <div className="release-section-heading">
                <div>
                  <h2>验收与归档</h2>
                  <p>按送验顺序查看冻结清单与验收结论。</p>
                </div>
              </div>
              {!m && (
                <p className="text-sm text-muted-foreground">
                  完成版本核对、冻结送验后，清单与下载入口会出现在这里。
                </p>
              )}
              {flow.manifests.map((v) => (
                <section key={v.id} className="release-manifest">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <b>清单 #{v.sequence_no}</b>
                    <FrozenDetails
                      path={path}
                      id={v.id}
                      sequence={v.sequence_no}
                    />
                    <a
                      className="text-sm underline"
                      href={
                        "/api/v1" + path + "/manifests/" + v.id + "/download"
                      }
                      download
                    >
                      下载冻结版本 ZIP
                    </a>
                  </div>
                  <p className="mt-2 text-sm">
                    {v.decision === "pass"
                      ? "验收通过"
                      : v.decision === "return"
                        ? "已退回"
                        : "待验收"}{" "}
                    · {new Date(v.created_at).toLocaleString()}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm">
                    {v.review_note}
                  </p>
                  <small className="break-all text-muted-foreground">
                    SHA-256 {v.digest}
                  </small>
                </section>
              ))}
            </>
          ) : (
            <>
              {preview && (
                <ReleaseCheckResult
                  ref={previewBox}
                  check={preview.data}
                  stale={!currentPreview}
                  canManage={manage && integrating && !working}
                  pending={pending}
                  repositories={set.repositories}
                  act={act}
                />
              )}
              <ReleaseRepositories
                path={path}
                flow={flow}
                set={set}
                status={r.status}
                act={act}
                pending={pending || Boolean(working)}
              />
            </>
          )}
          {(section === "history" || section === "repos") &&
            flow.operations.length > 0 && (
              <details className="release-log">
                <summary className="cursor-pointer font-medium">
                  Git 操作记录 · {flow.operations.length}
                </summary>
                {flow.operations.map((o, n) => (
                  <div key={o.id} className="mt-2 border-t pt-2 text-sm">
                    {actions[o.kind] || o.kind} · {state[o.status]} ·{" "}
                    {new Date(o.created_at).toLocaleString()}
                    {n === 0 &&
                      flow.steps.map((v, i) => (
                        <p className="break-all text-muted-foreground" key={i}>
                          {
                            set.repositories.find((r) => r.id === v.repo_id)
                              ?.full_path
                          }{" "}
                          · {state[v.status]} {v.observed?.reason}
                        </p>
                      ))}
                  </div>
                ))}
              </details>
            )}
        </div>
      </section>
      {task && (
        <FlowDrawer
          key={task.op}
          task={task}
          r={r}
          path={path}
          m={m}
          token={currentPreview?.preview_token}
          operation={active}
          close={() => choose(undefined)}
          saved={done}
        />
      )}
    </div>
  );
}
