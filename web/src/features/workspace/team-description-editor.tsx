import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Save } from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { MarkdownEditor } from "@/components/markdown";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { Resource } from "@/types/collaboration";

export function TeamDescriptionEditor() {
  const { teamId } = useParams();
  const query = useApiQuery<Resource>(["team", teamId], `/teams/${teamId}`, {
    enabled: Boolean(teamId && /^[1-9]\d*$/.test(teamId)),
  });
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && <EditorPage key={teamId} team={query.data.data} />}
    </AsyncBoundary>
  );
}

function EditorPage({ team }: { team: Resource }) {
  const saving = useRef(false);
  const [source, setSource] = useState(team.description);
  const [baseline, setBaseline] = useState(team.description);
  const [etag, setEtag] = useState(team.etag);
  const [latest, setLatest] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<unknown>(null);
  const submission = useSubmission();
  const client = useQueryClient();
  const dirty = source !== baseline;
  const allowed =
    team.can_manage &&
    team.status === "active" &&
    (!latest || (latest.can_manage && latest.status === "active"));
  const conflict =
    submission.error instanceof ApiError &&
    ["VERSION_CONFLICT", "PRECONDITION_REQUIRED"].includes(
      submission.error.code,
    );
  const blocked =
    !allowed ||
    submission.pending ||
    submission.uncertain ||
    conflict ||
    loading ||
    !etag;
  useUnsaved(dirty, submission.pending);
  async function save() {
    if (saving.current || blocked || !dirty) return;
    if (new TextEncoder().encode(source).length > 102400) {
      setError(new Error("团队描述不能超过 100 KiB，请精简内容后保存。"));
      return;
    }
    setError(null);
    setFeedback("");
    saving.current = true;
    try {
      await submission.run(async () => {
        const response = await request<Resource>(`/teams/${team.id}`, {
          method: "PATCH",
          etag,
          body: { description: source },
        });
        setBaseline(source);
        setEtag(response.data.etag || response.etag);
        setFeedback("团队描述已保存");
        setLatest(null);
        await client.invalidateQueries({ queryKey: ["team", team.id] });
        await client.invalidateQueries({ queryKey: ["teams"] });
      });
    } finally {
      saving.current = false;
    }
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });
  async function reload() {
    if (loading || submission.pending) return;
    setLoading(true);
    setError(null);
    try {
      const response = await request<Resource>(`/teams/${team.id}`);
      setLatest({
        ...response.data,
        etag: response.data.etag || response.etag,
      });
      if (submission.uncertain && response.data.description === source) {
        setBaseline(source);
        setEtag(response.data.etag || response.etag);
        submission.setError(null);
        setFeedback("已核实服务器内容与当前草稿一致");
        await client.invalidateQueries({ queryKey: ["team", team.id] });
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }
  const toolbarStart = (
    <>
      <Button
        asChild
        variant="ghost"
        size="iconSm"
        disabled={submission.pending}
      >
        <Link
          to={`/admin/teams/${team.id}`}
          aria-label="返回团队信息"
          title="返回团队信息"
          onClick={(event) => {
            if (submission.pending) event.preventDefault();
          }}
        >
          <ArrowLeft />
        </Link>
      </Button>
    </>
  );
  const toolbarEnd = (
    <>
      <span className="mr-2 text-xs text-muted" role="status">
        {feedback || (dirty ? "有未保存的修改" : "内容已保存")}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          try {
            const url = URL.createObjectURL(
              new Blob([source], { type: "text/markdown;charset=utf-8" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = `${team.code}.md`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (caught) {
            setError(caught);
          }
        }}
      >
        <Download />
        下载 Markdown
      </Button>
      <Button
        size="sm"
        disabled={blocked || !dirty}
        pending={submission.pending}
        onClick={() => void save()}
      >
        <Save />
        保存
      </Button>
    </>
  );
  const notices = (
    <>
      {!allowed && <Notice>当前团队不可编辑，仍可阅读和下载内容。</Notice>}
      <ErrorNotice error={error || submission.error} />
      {(conflict || submission.uncertain || !etag) && (
        <Notice tone="warning">
          <p>
            {submission.uncertain
              ? "保存结果未知，请先核实服务器内容。草稿已保留，不会自动重复提交。"
              : "团队资料版本已变化，请加载最新内容，核对后再决定保存。草稿不会被覆盖。"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            pending={loading}
            onClick={() => void reload()}
          >
            加载最新内容
          </Button>
        </Notice>
      )}
      {latest && (
        <details className="rounded-lg border bg-surface p-3" open>
          <summary className="cursor-pointer text-sm">
            服务器最新描述 · 核对后继续
          </summary>
          <pre className="my-3 max-h-40 overflow-auto whitespace-pre-wrap text-xs">
            {latest.description || "（空内容）"}
          </pre>
          {
            <Button
              size="sm"
              variant="outline"
              disabled={!latest.can_manage || latest.status !== "active"}
              onClick={() => {
                setEtag(latest.etag);
                setBaseline(latest.description);
                submission.setError(null);
                setLatest(null);
                setFeedback("已采用最新版本，当前草稿保留，请核对后保存");
              }}
            >
              采用最新版本，保留草稿
            </Button>
          }
        </details>
      )}
    </>
  );
  return (
    <div className="team-description-workspace">
      <MarkdownEditor
        initial={team.description}
        onChange={(value) => {
          setSource(value);
          setFeedback("");
          setError(null);
        }}
        toolbarStart={toolbarStart}
        toolbarEnd={toolbarEnd}
        notices={notices}
        workspace
        disabled={!allowed || submission.pending}
        onSave={() => void save()}
      />
    </div>
  );
}
