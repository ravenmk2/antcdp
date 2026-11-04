import { useState, useRef, useEffect, useCallback } from "react";
import { request, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/platform/feedback";
import {
  actions,
  type Command,
  type Manifest,
  type MR,
  type Op,
  type Release,
} from "./releases";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormDrawer } from "@/components/platform/form-drawer";
import { releaseDisplayName } from "./release-labels";
import "./ReleaseChanges.css";
type CandidateMR = MR & { source_branch?: string; target_branch?: string };
export function FlowDrawer({
  task: t,
  r,
  path,
  m,
  token,
  operation,
  close,
  saved,
}: {
  task: Command;
  r: Release;
  path: string;
  m?: Manifest;
  token?: string;
  operation?: Op;
  close: () => void;
  saved: () => void;
}) {
  const [ref, setRef] = useState(t.ref || ""),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [opts, options] = useState<CandidateMR[]>([]),
    [mrLoading, setMRLoading] = useState(false),
    [mrError, setMRError] = useState(""),
    [mrSearch, setMRSearch] = useState(""),
    [page, setPage] = useState(1),
    [end, setEnd] = useState(false),
    [actor, setActor] = useState(""),
    [actorToken, setActorToken] = useState("");
  const [writeTag] = useState(r.etag);
  const lock = useRef(false),
    key = useRef<string>(crypto.randomUUID?.() || "");
  const mrRequest = useRef<AbortController | null>(null);
  const repoID = t.repo?.id;
  const verificationExpired = t.op === "freeze" && !token;
  const candidates = opts.filter((mr) =>
    `!${mr.iid} ${mr.title}`
      .toLocaleLowerCase()
      .includes(mrSearch.trim().toLocaleLowerCase()),
  );
  const remote = ["merge", "archive", "create-revert"].includes(t.op),
    needsRef = [
      "select-mr",
      "include-commit",
      "link-revert",
      "baseline",
    ].includes(t.op);
  const load = useCallback(
    async (nextPage: number) => {
      if (!repoID || (mrRequest.current && !mrRequest.current.signal.aborted))
        return;
      const controller = new AbortController();
      mrRequest.current = controller;
      setMRLoading(true);
      setMRError("");
      try {
        const res = await request<CandidateMR[]>(
          path + "/mr-options?page=" + nextPage,
          {
            method: "POST",
            body: { repo_id: repoID },
            etag: writeTag,
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        options((old) =>
          Array.from(
            new Map(
              [...(nextPage === 1 ? [] : old), ...res.data].map((mr) => [
                mr.iid,
                mr,
              ]),
            ).values(),
          ),
        );
        setPage(nextPage + 1);
        setEnd(res.data.length < 20);
      } catch (e) {
        if (!controller.signal.aborted) setMRError(errorMessage(e));
      } finally {
        if (mrRequest.current === controller && !controller.signal.aborted) {
          mrRequest.current = null;
          setMRLoading(false);
        }
      }
    },
    [path, repoID, writeTag],
  );
  useEffect(() => {
    if (t.op === "select-mr") void load(1);
    return () => mrRequest.current?.abort();
  }, [load, t.op]);
  async function save() {
    if (lock.current) return;
    if (verificationExpired) {
      setError("核对结果已失效，请关闭后重新核对版本与材料。");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const body: Record<string, string> = { note };
    if (t.repo) body.repo_id = t.repo.id;
    if (needsRef) body.ref = ref;
    if (t.change) body.change_id = t.change.id;
    if (t.op === "link-revert") body.original_id = t.change!.id;
    if (t.op === "merge") body.sha = t.change!.evidence.sha;
    if (t.op === "create-revert")
      body.sha =
        t.change!.kind === "commit"
          ? t.change!.ref
          : t.change!.evidence.merge_commit_sha ||
            t.change!.evidence.squash_commit_sha ||
            t.change!.evidence.sha;
    if (t.op === "freeze") body.digest = token!;
    if (["review", "return", "archive"].includes(t.op)) {
      body.manifest_id = m!.id;
      body.digest = m!.digest;
    }
    if (t.decision) body.decision = t.decision;
    if (t.op === "reconcile") body.operation_id = operation!.id;
    try {
      if (t.op === "refresh-scope" && !actor) {
        const v = await request<{
          adds: string[];
          drops: string[];
          token: string;
        }>(path + "/scope-preview", {
          method: "POST",
          etag: writeTag,
          body: {},
        });
        setActor(
          "新增 " +
            (v.data.adds.join("、") || "无") +
            "；移出 " +
            (v.data.drops.join("、") || "无"),
        );
        setRef(v.data.token);
        return;
      }
      if (t.op === "refresh-scope") body.digest = ref;
      if (remote && !actor) {
        const v = await request<{ identity: string; token: string }>(
          path + "/git-identity",
          {
            method: "POST",
            etag: writeTag,
            body: t.repo ? { repo_id: t.repo.id } : {},
          },
        );
        setActor(v.data.identity);
        setActorToken(v.data.token);
        return;
      }
      if (remote && !key.current) {
        const bytes = Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          (b) => b.toString(16).padStart(2, "0"),
        ).join("");
        key.current = [
          bytes.slice(0, 8),
          bytes.slice(8, 12),
          bytes.slice(12, 16),
          bytes.slice(16, 20),
          bytes.slice(20),
        ].join("-");
      }
      if (remote) body.actor_token = actorToken;
      await request(path + "/" + t.op, {
        method: "POST",
        etag: writeTag,
        headers: remote ? { "Idempotency-Key": key.current } : {},
        body,
      });
      saved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <FormDrawer
      size="compact"
      title={actions[t.op]}
      description={
        releaseDisplayName(r) +
        " · " +
        r.tag_name +
        (t.repo ? " · " + t.repo.full_path + " / " + t.repo.main_branch : "")
      }
      pending={busy}
      dirty={!!note || ref !== (t.ref || "")}
      onClose={close}
      footer={(cancel) => (
        <>
          <Button variant="outline" onClick={() => cancel()}>
            取消
          </Button>
          <Button
            form="flow-command"
            type="submit"
            disabled={busy || verificationExpired}
          >
            {busy
              ? "处理中…"
              : t.op === "refresh-scope" && !actor
                ? "预览范围变化"
                : remote && !actor
                  ? "核对 GitLab 身份"
                  : "确认" + actions[t.op]}
          </Button>
        </>
      )}
    >
      <form
        id="flow-command"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        {verificationExpired && !error && (
          <ErrorBox>核对结果已失效，请关闭后重新核对版本与材料。</ErrorBox>
        )}
        {actor && (
          <p className="break-all rounded-lg bg-muted p-3">
            {t.op === "refresh-scope" ? "范围变化" : "GitLab 执行身份"} ·{" "}
            {actor}
          </p>
        )}
        {t.change && (
          <p className="break-all">
            {t.change.kind === "mr" ? "MR !" : "提交 "}
            {t.change.ref} · {t.change.evidence.title}
          </p>
        )}
        {t.op === "select-mr" && (
          <section className="release-mr-candidates" aria-label="候选 MR">
            <h3>待合并 MR</h3>
            <p className="release-mr-hint">
              仅显示指向 {t.repo?.main_branch}{" "}
              的待合并请求。选择一项后确认添加。
            </p>
            {mrLoading && (
              <p role="status" className="release-mr-hint">
                正在读取待合并 MR…
              </p>
            )}
            {mrError && <ErrorBox>{mrError}</ErrorBox>}
            {!mrLoading && !mrError && end && opts.length === 0 && (
              <p className="release-mr-hint">
                未找到待合并的 MR。此仓库可以没有
                MR；已合并的请求可在下方通过编号登记。
              </p>
            )}
            {opts.length > 0 && (
              <Input
                aria-label="搜索已加载的 MR"
                placeholder="搜索已加载的 MR 编号或标题"
                value={mrSearch}
                onChange={(e) => setMRSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
            )}
            {opts.length > 0 && (
              <div className="release-mr-options">
                {candidates.map((o) => (
                  <button
                    key={o.iid}
                    type="button"
                    className="release-mr-option"
                    disabled={busy}
                    aria-label={`选择 MR !${o.iid}：${o.title}`}
                    aria-pressed={ref === String(o.iid)}
                    onClick={() => setRef(String(o.iid))}
                  >
                    <span>
                      <b>!{o.iid}</b>
                      <strong>{o.title}</strong>
                    </span>
                    {o.source_branch && (
                      <small>
                        {o.source_branch} →{" "}
                        {o.target_branch || t.repo?.main_branch}
                      </small>
                    )}
                    {ref === String(o.iid) && <small>已选择</small>}
                  </button>
                ))}
                {candidates.length === 0 && (
                  <p className="release-mr-hint">
                    已加载的 MR 中没有匹配项。可修改搜索词
                    {!end ? "或继续加载更多 MR" : ""}。
                  </p>
                )}
              </div>
            )}
            {!mrLoading && (mrError || !end) && (
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => void load(page)}
              >
                {mrError ? "重试读取 MR" : "查询更多待合并 MR"}
              </Button>
            )}
          </section>
        )}
        {needsRef && (
          <label className="block text-sm">
            {t.op === "baseline"
              ? "基线 Tag 或 SHA（留空采用默认基线）"
              : t.op === "include-commit"
                ? "完整提交 SHA"
                : "MR 编号"}
            <Input
              required={t.op !== "baseline"}
              value={ref}
              disabled={busy}
              onChange={(e) => setRef(e.target.value)}
            />
          </label>
        )}
        {t.op === "select-mr" && (
          <p className="release-mr-hint">
            也可手动输入 MR 编号，支持登记已合并到该主干的 MR。
          </p>
        )}
        {["include-commit", "review", "return", "terminate"].includes(t.op) && (
          <label className="block text-sm">
            处理说明
            <Textarea
              required={t.decision !== "pass"}
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        )}
        {t.op === "archive" && (
          <p>按清单 #{m!.sequence_no} 的冻结 SHA 逐仓创建或核实 Tag。</p>
        )}
        {t.op === "terminate" && (
          <p>
            终止将释放本次发布占用的主干。请记录已经合入的提交或已创建的 Tag
            的处置方式。
          </p>
        )}
        {t.op === "start" && (
          <p>开始后本次发布将占用范围内全部仓库的主干，直到归档或终止。</p>
        )}
      </form>
    </FormDrawer>
  );
}
