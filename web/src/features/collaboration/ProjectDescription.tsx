import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { RefreshCw, Code2, Eye, Columns2, ArrowUp } from "lucide-react";
import { useIdentity } from "@/app/identity";
import type { Resource } from "@/shared/collaboration";
import { request, errorMessage } from "@/lib/api";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "./MarkdownEditor";
import { EmptyState, ErrorBox } from "@/components/platform/feedback";
import { Field } from "@/components/platform/field";
import { CopyButton } from "@/components/platform/copy-button";
import { useFormErrors } from "@/components/platform/use-form-errors";
import {
  useNavigateAfterSave,
  useNavigationProtection,
} from "@/components/platform/navigation-guard";
import { Markdown, parseDescription } from "./Markdown";

type Props = { project: Resource; edit: boolean; onSaved: () => void };
type ReadingPosition = { top: number; anchor?: string; offset?: number };

function descriptionURL(pathname: string, search: string, edit = false) {
  const query = new URLSearchParams(search);
  query.set("tab", "description");
  if (edit) query.set("edit", "1");
  else query.delete("edit");
  return pathname + "?" + query;
}

export function ProjectDescription({ project, edit, onSaved }: Props) {
  const allowed = project.can_manage && project.status === "active";
  if (edit) {
    return (
      <DescriptionEditor key={project.id} project={project} onSaved={onSaved} />
    );
  }
  return (
    <DescriptionReader key={project.id} project={project} allowed={allowed} />
  );
}

function DescriptionReader({
  project,
  allowed,
}: {
  project: Resource;
  allowed: boolean;
}) {
  const { session } = useIdentity();
  const location = useLocation();
  const rendered = useMemo(
    () => parseDescription(project.description, `project-${project.id}`, true),
    [project.description, project.id],
  );
  const article = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState("");
  const [showTop, setShowTop] = useState(false);
  const storageKey = `antcdp.project-description:${session.user.id}:${project.id}`;

  useEffect(() => {
    const headings = rendered.headings
      .map((heading) => document.getElementById(heading.id))
      .filter((element): element is HTMLElement => !!element);
    let frame = 0;
    const update = () => {
      let active = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 130) active = heading;
        else break;
      }
      setCurrent(active?.id || "");
      setShowTop(window.scrollY > window.innerHeight);
      const position: ReadingPosition = { top: window.scrollY };
      if (active) {
        position.anchor = active.id;
        position.offset = active.getBoundingClientRect().top;
      }
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(position));
      } catch {
        /* Optional reading preference. */
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(() => {
      let hash = "";
      try {
        hash = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        /* Invalid bookmarks fall back to the saved position. */
      }
      const linked = headings.find((heading) => heading.id === hash);
      if (linked) linked.scrollIntoView({ block: "start" });
      else {
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(storageKey) || "null",
          ) as ReadingPosition | null;
          if (saved && Number.isFinite(saved.top)) {
            const anchor = headings.find(
              (heading) => heading.id === saved.anchor,
            );
            const top =
              anchor && Number.isFinite(saved.offset)
                ? anchor.getBoundingClientRect().top +
                  window.scrollY -
                  saved.offset!
                : saved.top;
            window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
          }
        } catch {
          /* Browser storage is optional. */
        }
      }
      update();
      window.addEventListener("scroll", onScroll, { passive: true });
      window.addEventListener("resize", onScroll);
      window.addEventListener("pagehide", update);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pagehide", update);
    };
  }, [rendered, storageKey]);

  const editLink = descriptionURL(location.pathname, location.search, true);
  if (!project.description.trim()) {
    return (
      <section aria-label="项目介绍">
        <EmptyState
          title="尚未填写项目介绍"
          description="在这里记录项目背景、使用方式和开发约定。"
          action={
            allowed ? (
              <Button asChild>
                <Link to={editLink}>编写项目介绍</Link>
              </Button>
            ) : undefined
          }
        />
      </section>
    );
  }
  return (
    <section className="project-description-reader" aria-label="项目介绍">
      {!rendered.headings.some((heading) => heading.level === 1) && (
        <h1 className="sr-only">项目介绍</h1>
      )}
      <div
        className={`project-reading${rendered.headings.length > 1 ? "" : " project-reading-no-toc"}`}
      >
        <article
          ref={article}
          tabIndex={-1}
          aria-label={`${project.name}介绍正文`}
        >
          <Markdown enhanced text={project.description} rendered={rendered} />
        </article>
        {rendered.headings.length > 1 && (
          <nav className="project-toc" aria-label="项目介绍目录">
            <h2 className="mb-3 text-sm font-medium">目录</h2>
            {rendered.headings.map((heading) => (
              <a
                key={heading.id}
                href={`#${encodeURIComponent(heading.id)}`}
                data-level={heading.level}
                aria-current={current === heading.id ? "location" : undefined}
              >
                {heading.text}
              </a>
            ))}
          </nav>
        )}
      </div>
      {showTop && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="project-back-to-top"
          aria-label="返回顶部"
          title="返回顶部"
          onClick={(event) => {
            if (event.detail === 0)
              article.current?.focus({ preventScroll: true });
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "instant"
                : "smooth",
            });
          }}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      )}
    </section>
  );
}

function DescriptionEditor({
  project,
  onSaved,
}: Pick<Props, "project" | "onSaved">) {
  const location = useLocation();
  const afterSave = useNavigateAfterSave();
  const [baseline, setBaseline] = useState(project);
  const [draft, setDraft] = useState(project.description);
  const [mode, setMode] = useState<"edit" | "preview" | "split">("split");
  const [pending, setPending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState<Resource | null>(null);
  const [reviewError, setReviewError] = useState("");
  const lock = useRef(false);
  const errors = useFormErrors();
  const dirty = draft !== baseline.description;
  const bytes = new TextEncoder().encode(draft).length;
  const readURL = descriptionURL(location.pathname, location.search);
  const allowed = project.can_manage && project.status === "active";
  useNavigationProtection(pending ? "pending" : dirty ? "dirty" : undefined);

  useEffect(() => {
    const form = errors.formRef.current;
    if (!form) return;
    const measure = () => {
      const top = form.getBoundingClientRect().top + window.scrollY;
      form.style.setProperty("--editor-top", `${top}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [errors.formRef]);

  function complete() {
    onSaved();
    afterSave(readURL);
  }
  async function save() {
    if (lock.current || !allowed || blocked || !dirty) return;
    errors.clear();
    if (bytes > 102400) {
      setMode("edit");
      errors.validate({ description: "Markdown 内容不能超过 100 KiB。" });
      return;
    }
    if (!baseline.etag) {
      errors.setError("版本信息缺失，请返回阅读页后重新打开编辑。");
      return;
    }
    lock.current = true;
    setPending(true);
    try {
      await request<Resource>(`/projects/${project.id}`, {
        method: "PATCH",
        etag: baseline.etag,
        body: { description: draft },
      });
      complete();
    } catch (error) {
      setMode("split");
      errors.show(error, ["description"]);
      setBlocked(writeRequiresReview(error));
      setLatest(null);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  async function checkLatest() {
    if (checking) return;
    setChecking(true);
    setReviewError("");
    try {
      const response = await request<Resource>(`/projects/${project.id}`);
      setLatest({
        ...response.data,
        etag: response.etag || response.data.etag,
      });
    } catch (error) {
      setReviewError(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }
  function continueWithLatest() {
    if (!latest?.etag || !latest.can_manage || latest.status !== "active")
      return;
    setBaseline(latest);
    setBlocked(false);
    setLatest(null);
    errors.clear();
  }

  return (
    <form
      ref={errors.formRef}
      className="project-description-editor"
      aria-label="编辑项目介绍"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="project-description-toolbar">
        <h1 className="sr-only">编辑项目介绍</h1>
        <div
          className="project-description-modes"
          role="group"
          aria-label="介绍编辑模式"
        >
          {(
            [
              ["edit", "编辑", Code2],
              ["preview", "预览", Eye],
              ["split", "分栏", Columns2],
            ] as const
          ).map(([value, label, Icon]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={mode === value ? "secondary" : "ghost"}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
        </div>
        <div className="project-description-actions">
          <span className={bytes > 102400 ? "text-destructive" : undefined}>
            {(bytes / 1024).toFixed(1)} / 100 KiB
          </span>
          <span
            role="status"
            className={blocked ? "text-[var(--warning)]" : undefined}
          >
            {blocked
              ? "需核对保存结果"
              : pending
                ? "正在保存…"
                : errors.error
                  ? "保存失败"
                  : dirty
                    ? "有未保存修改"
                    : "已保存内容"}
          </span>
          <Button asChild variant="outline">
            <Link
              to={readURL}
              aria-disabled={pending}
              onClick={(event) => {
                if (pending) event.preventDefault();
              }}
            >
              取消
            </Link>
          </Button>
          <Button
            type="submit"
            disabled={pending || blocked || !dirty || !allowed}
          >
            {pending ? "正在保存…" : "保存"}
          </Button>
        </div>
      </div>
      <div className="project-description-feedback">
        <ErrorBox>{errors.error}</ErrorBox>
        {!allowed && (
          <div className="mb-5 space-y-3">
            <ErrorBox tone="warning">
              当前项目不允许编辑。已有草稿仍保留，可复制后返回阅读页。
            </ErrorBox>
            <CopyButton value={draft} label="复制当前草稿" />
          </div>
        )}
        {blocked && (
          <section
            className="project-description-review"
            aria-label="保存结果核对"
          >
            <ErrorBox tone="warning">{writeReviewMessage}</ErrorBox>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={checking}
                onClick={() => void checkLatest()}
              >
                <RefreshCw className={checking ? "animate-spin" : ""} />
                {checking ? "正在读取…" : "读取最新内容"}
              </Button>
              <CopyButton value={draft} label="复制当前草稿" />
            </div>
            <ErrorBox>{reviewError}</ErrorBox>
            {latest && (
              <>
                <details open>
                  <summary>当前已保存的介绍</summary>
                  <Markdown
                    enhanced
                    text={latest.description || "尚未填写项目介绍。"}
                    anchorPrefix={`review-${project.id}`}
                  />
                </details>
                {latest.description === draft ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-muted-foreground">
                      最新内容与当前草稿一致。
                    </p>
                    <Button type="button" onClick={complete}>
                      完成并返回阅读
                    </Button>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <p className="text-sm text-muted-foreground">
                      先对照已保存内容调整草稿。继续后，再次保存将用当前草稿替换介绍。
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !latest.etag ||
                        !latest.can_manage ||
                        latest.status !== "active"
                      }
                      onClick={continueWithLatest}
                    >
                      已核对，保留草稿并继续编辑
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </div>
      <div className="project-document-editor" data-mode={mode}>
        <div className="project-source-pane" hidden={mode === "preview"}>
          <Field
            label="Markdown 正文"
            error={errors.fields.description}
            hint="支持 Markdown、代码高亮与 Mermaid 图表。不支持 HTML 或嵌入图片。"
          >
            {(props) => (
              <MarkdownEditor
                {...props}
                value={draft}
                disabled={pending || !allowed}
                onChange={(value) => {
                  setDraft(value);
                  errors.setFields({});
                }}
              />
            )}
          </Field>
        </div>
        {mode !== "edit" && (
          <section aria-label="介绍预览">
            <h3 className="mb-2 text-sm font-medium">预览</h3>
            <div className="project-description-preview">
              <Markdown
                enhanced
                text={draft || "尚未填写项目介绍。"}
                anchorPrefix={`preview-${project.id}`}
              />
            </div>
          </section>
        )}
      </div>
    </form>
  );
}
