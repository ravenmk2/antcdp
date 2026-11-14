import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Save } from "lucide-react";
import { ApiError, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { MarkdownEditor } from "@/components/markdown";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { Resource, ResourceKind } from "@/types/collaboration";

export function ResourceDescriptionEditor({
  kind,
  returnTo,
}: {
  kind: ResourceKind;
  returnTo: (resource: Resource) => string;
}) {
  const params = useParams();
  const id = kind === "projects" ? params.projectId : params.teamId;
  const singular = kind === "projects" ? "project" : "team";
  const query = useApiQuery<Resource>([singular, id], `/${kind}/${id ?? ""}`, {
    enabled: Boolean(id && /^[1-9]\d*$/.test(id)),
  });
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data && (
        <EditorPage
          key={id}
          kind={kind}
          returnTo={returnTo(query.data.data)}
          resource={query.data.data}
        />
      )}
    </AsyncBoundary>
  );
}

function EditorPage({
  kind,
  returnTo,
  resource,
}: {
  kind: ResourceKind;
  returnTo: string;
  resource: Resource;
}) {
  const project = kind === "projects";
  const singular = project ? "project" : "team";
  const contentLabel = project ? "项目介绍" : "团队介绍";
  const saving = useRef(false);
  const [source, setSource] = useState(resource.description);
  const [baseline, setBaseline] = useState(resource.description);
  const [etag, setEtag] = useState(resource.etag);
  const [latest, setLatest] = useState<Resource | null>(null);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<unknown>(null);
  const submission = useSubmission();
  const client = useQueryClient();
  const navigate = useNavigate();
  const dirty = source !== baseline;
  const allowed =
    resource.can_manage &&
    resource.status === "active" &&
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
  const releaseUnsaved = useUnsaved(dirty, submission.pending);

  async function save() {
    if (saving.current || blocked || !dirty) return;
    if (new TextEncoder().encode(source).length > 102400) {
      setError(
        new Error(`${contentLabel}不能超过 100 KiB，请精简内容后保存。`),
      );
      return;
    }
    setError(null);
    setFeedback("");
    saving.current = true;
    try {
      const saved = await submission.run(async () => {
        const response = await request<Resource>(`/${kind}/${resource.id}`, {
          method: "PATCH",
          etag,
          body: { description: source },
        });
        setBaseline(source);
        setEtag(response.data.etag || response.etag);
        setFeedback(`${contentLabel}已保存`);
        setLatest(null);
        await client.invalidateQueries({ queryKey: [singular, resource.id] });
        await client.invalidateQueries({ queryKey: [kind] });
      });
      if (saved) {
        releaseUnsaved();
        void navigate(returnTo);
      }
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
      const response = await request<Resource>(`/${kind}/${resource.id}`);
      setLatest({
        ...response.data,
        etag: response.data.etag || response.etag,
      });
      if (submission.uncertain && response.data.description === source) {
        setBaseline(source);
        setEtag(response.data.etag || response.etag);
        submission.setError(null);
        setFeedback("已核实服务器内容与当前草稿一致");
        await client.invalidateQueries({ queryKey: [singular, resource.id] });
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }

  const returnLabel = project ? "返回项目信息" : "返回团队信息";
  const toolbarStart = (
    <Button
      render={
        <Link
          to={returnTo}
          aria-label={returnLabel}
          title={returnLabel}
          onClick={(event) => {
            if (submission.pending) event.preventDefault();
          }}
        >
          <ArrowLeft />
        </Link>
      }
      nativeButton={false}
      role="link"
      variant="ghost"
      size="iconSm"
      disabled={submission.pending}
    />
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
            a.download = `${resource.code}.md`;
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
      {!allowed && (
        <Notice>
          当前{project ? "项目" : "团队"}不可编辑，仍可阅读和下载内容。
        </Notice>
      )}
      <ErrorNotice error={error || submission.error} />
      {(conflict || submission.uncertain || !etag) && (
        <Notice tone="warning">
          <p>
            {submission.uncertain
              ? "保存结果未知，请先核实服务器内容。草稿已保留，不会自动重复提交。"
              : `${project ? "项目" : "团队"}资料版本已变化，请加载最新内容，核对后再决定保存。草稿不会被覆盖。`}
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
        </details>
      )}
    </>
  );
  return (
    <div className={`${singular}-description-workspace`}>
      <MarkdownEditor
        initial={resource.description}
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
