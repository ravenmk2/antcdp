import { useState, useRef, type ReactNode } from "react";
import { request, errorMessage } from "@/lib/api";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { FormDrawer } from "@/components/platform/form-drawer";
import { ErrorBox } from "@/components/platform/feedback";
import { Field } from "@/components/platform/field";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { CopyButton } from "@/components/platform/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Page, Variant } from "@/shared/delivery";
import type { Release } from "./releases";
import { releaseDisplayName, releaseStatusLabels } from "./release-labels";

type EditorKind = "settings" | "create" | "description" | "details";
type Review = { variant: Variant } | { release: Release } | { missing: true };
export function ReleaseEditor({
  kind,
  r,
  base,
  variant,
  close,
  saved,
  preparation,
}: {
  kind: EditorKind;
  r: Release | null;
  base: string;
  variant: Variant;
  close: () => void;
  saved: (id?: string) => void;
  preparation?: ReactNode;
}) {
  const [baseline, setBaseline] = useState(r),
    [name, setName] = useState(r?.name || ""),
    [version, setVersion] = useState(r?.version_label || ""),
    [notes, setNotes] = useState(r?.description_md || ""),
    [prefix, setPrefix] = useState(variant.release_tag_prefix || ""),
    [savedPrefix, setSavedPrefix] = useState(variant.release_tag_prefix || ""),
    [prefixTag, setPrefixTag] = useState(variant.etag),
    [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(false),
    [blocked, setBlocked] = useState<"prefix" | "release" | "create">(),
    [review, setReview] = useState<Review>(),
    [reviewError, setReviewError] = useState("");
  const lock = useRef(false);
  const errors = useFormErrors();
  const create = kind === "create";
  const releaseEditable =
    !baseline || ["draft", "integrating"].includes(baseline.status);
  const editVersion =
    create || (kind === "details" && baseline?.status === "draft");
  const needsPrefix = create && !savedPrefix;
  const effectivePrefix = create
    ? savedPrefix || prefix
    : r?.tag_name.slice(0, -r.version_label.length) || prefix;
  const dirty =
    kind === "settings"
      ? prefix !== (variant.release_tag_prefix || "")
      : create
        ? !!name ||
          !!version ||
          !!notes ||
          prefix !== (variant.release_tag_prefix || "")
        : kind === "description"
          ? notes !== baseline?.description_md
          : name !== (baseline?.name || "") ||
            (editVersion && version !== baseline?.version_label);
  const draftText =
    kind === "settings"
      ? prefix
      : [name, version, notes].filter(Boolean).join("\n\n");

  async function save() {
    if (lock.current || blocked || !releaseEditable) return;
    errors.clear();
    const fields: Record<string, string> = {};
    if (
      (create || kind === "details") &&
      (Array.from(name.trim()).length > 120 ||
        /[\p{Cc}\u2028\u2029]/u.test(name.trim()))
    )
      fields.name = "名称最多 120 个字符，不能包含换行或控制字符。";
    if (
      editVersion &&
      !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?$/.test(version.trim())
    )
      fields.version_label =
        "填写 1–96 位版本号，使用字母、数字、点、短横线或下划线，并以字母或数字开头、结尾。";
    if (
      (kind === "settings" || needsPrefix) &&
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(prefix.trim())
    )
      fields.tag_prefix =
        "填写 1–96 位 Tag 前缀，以字母或数字开头，可包含点、短横线或下划线。";
    if ((create || kind === "description") && Array.from(notes).length > 16000)
      fields.description_md = "发布说明最多 16000 个字符。";
    if (!errors.validate(fields)) return;
    if (
      ((kind === "settings" || needsPrefix) && !prefixTag) ||
      (!create && kind !== "settings" && !baseline?.etag)
    ) {
      errors.setError("版本信息缺失，请关闭后重新打开编辑。");
      return;
    }
    let target: "prefix" | "release" | "create" =
      kind === "settings" || needsPrefix
        ? "prefix"
        : create
          ? "create"
          : "release";
    lock.current = true;
    setBusy(true);
    try {
      if (target === "prefix") {
        const response = await request<{ tag_prefix: string }>(
          base + "/release-settings",
          {
            method: "PATCH",
            etag: prefixTag,
            body: { tag_prefix: prefix.trim() },
          },
        );
        setSavedPrefix(response.data.tag_prefix);
        setPrefixTag(response.etag);
        if (kind === "settings") {
          saved();
          return;
        }
        target = "create";
      }
      if (create) {
        const response = await request<Release>(base + "/releases", {
          method: "POST",
          body: {
            name: name.trim(),
            version_label: version.trim(),
            description_md: notes,
          },
        });
        saved(response.data.id);
      } else {
        await request(base + "/releases/" + baseline!.id, {
          method: "PATCH",
          etag: baseline!.etag,
          body:
            kind === "description"
              ? { description_md: notes }
              : {
                  name: name.trim(),
                  ...(editVersion && version.trim() !== baseline!.version_label
                    ? { version_label: version.trim() }
                    : {}),
                },
        });
        saved();
      }
    } catch (error) {
      errors.show(error, [
        "name",
        "version_label",
        "description_md",
        "tag_prefix",
      ]);
      if (writeRequiresReview(error)) {
        setBlocked(target);
        setReview(undefined);
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function checkLatest() {
    if (checking || !blocked) return;
    setChecking(true);
    setReview(undefined);
    setReviewError("");
    try {
      if (blocked === "prefix") {
        const response = await request<Variant>(base);
        setReview({
          variant: {
            ...response.data,
            etag: response.etag || response.data.etag,
          },
        });
      } else if (blocked === "release") {
        const response = await request<Release>(
          base + "/releases/" + baseline!.id,
        );
        setReview({
          release: {
            ...response.data,
            etag: response.etag || response.data.etag,
          },
        });
      } else {
        // Read all matching pages before claiming the attempted version is absent.
        let page = 1;
        for (;;) {
          const response = await request<Page<Release>>(
            `${base}/releases?q=${encodeURIComponent(version.trim())}&status=all&page=${page}&page_size=100`,
          );
          const existing = response.data.items.find(
            (item) => item.version_label === version.trim(),
          );
          if (existing) {
            const detail = await request<Release>(
              base + "/releases/" + existing.id,
            );
            setReview({ release: detail.data });
            break;
          }
          if (page * 100 >= response.data.total) {
            setReview({ missing: true });
            break;
          }
          if (page >= 20) throw new Error("too_many_matches");
          page++;
        }
      }
    } catch (error) {
      setReviewError(errorMessage(error));
    } finally {
      setChecking(false);
    }
  }
  function resume() {
    if (!review) return;
    if ("variant" in review) {
      setPrefixTag(review.variant.etag);
      if (create) {
        setSavedPrefix(review.variant.release_tag_prefix || "");
        if (review.variant.release_tag_prefix)
          setPrefix(review.variant.release_tag_prefix);
      }
    } else if ("release" in review) {
      setBaseline(review.release);
      if (review.release.status !== "draft")
        setVersion(review.release.version_label);
    }
    setBlocked(undefined);
    setReview(undefined);
    errors.clear();
  }
  const matchesSaved =
    review &&
    "release" in review &&
    (kind === "description"
      ? review.release.description_md === notes
      : (review.release.name || "") === name.trim() &&
        (!editVersion || review.release.version_label === version.trim()));
  const prefixMatches =
    review &&
    "variant" in review &&
    review.variant.release_tag_prefix === prefix.trim();
  const title = {
    settings: "产品分支 Tag 前缀",
    details: "编辑发布资料",
    create: "创建发布",
    description: "编辑发布说明",
  }[kind];
  return (
    <FormDrawer
      size={kind === "settings" || kind === "details" ? "compact" : "wide"}
      title={title}
      description={
        variant.name +
        (r ? " · " + releaseDisplayName(r) : " · " + variant.main_branch)
      }
      onClose={close}
      pending={busy || checking}
      dirty={dirty || !!blocked}
      footer={(cancel) => (
        <>
          <Button variant="outline" onClick={() => cancel()}>
            取消
          </Button>
          <Button
            type="submit"
            form="release-editor"
            disabled={
              busy ||
              checking ||
              !!blocked ||
              !releaseEditable ||
              (!create && !dirty)
            }
          >
            {busy
              ? "正在保存…"
              : create
                ? needsPrefix
                  ? "保存前缀并创建发布"
                  : "创建发布"
                : "保存"}
          </Button>
        </>
      )}
    >
      <form
        ref={errors.formRef}
        id="release-editor"
        className="space-y-5"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {create && preparation}
        {!releaseEditable && (
          <ErrorBox tone="warning">
            发布已进入
            {releaseStatusLabels[baseline!.status] || baseline!.status}
            ，当前资料不可编辑。草稿仍保留，可复制后关闭。
          </ErrorBox>
        )}
        {blocked && (
          <section className="release-write-review" aria-label="保存结果核对">
            <ErrorBox tone="warning">{writeReviewMessage}</ErrorBox>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={checking}
                onClick={() => void checkLatest()}
              >
                {checking ? "正在核对…" : "读取已保存记录"}
              </Button>
              <CopyButton value={draftText} label="复制当前草稿" />
            </div>
            <ErrorBox>{reviewError}</ErrorBox>
            {review && "variant" in review && (
              <div className="mt-3 space-y-3">
                <p className="break-all text-sm">
                  已保存的 Tag 前缀：
                  <code>{review.variant.release_tag_prefix || "尚未设置"}</code>
                </p>
                {kind === "settings" && prefixMatches ? (
                  <Button type="button" onClick={() => saved()}>
                    已核对，完成
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !review.variant.etag ||
                      !review.variant.can_manage ||
                      !!review.variant.archived_at
                    }
                    onClick={resume}
                  >
                    {create && review.variant.release_tag_prefix
                      ? "使用已保存前缀继续"
                      : "已核对，保留草稿继续"}
                  </Button>
                )}
              </div>
            )}
            {review && "release" in review && (
              <div className="mt-3 space-y-3">
                <dl className="release-review-values">
                  <div>
                    <dt>已保存名称</dt>
                    <dd>{review.release.name || "未填写"}</dd>
                  </div>
                  <div>
                    <dt>版本号</dt>
                    <dd>{review.release.version_label}</dd>
                  </div>
                  <div>
                    <dt>目标 Tag</dt>
                    <dd>{review.release.tag_name}</dd>
                  </div>
                  <div>
                    <dt>阶段</dt>
                    <dd>
                      {releaseStatusLabels[review.release.status] ||
                        review.release.status}
                    </dd>
                  </div>
                </dl>
                {(kind === "description" || create) && (
                  <details>
                    <summary>查看已保存的发布说明</summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm">
                      {review.release.description_md || "未填写"}
                    </p>
                  </details>
                )}
                {create ? (
                  <>
                    <p className="text-[13px] text-muted-foreground">
                      此版本已存在，请对照资料后打开，当前不会再次创建。
                    </p>
                    <Button
                      type="button"
                      onClick={() => saved(review.release.id)}
                    >
                      打开已存在发布
                    </Button>
                  </>
                ) : matchesSaved ? (
                  <>
                    <p className="text-[13px] text-muted-foreground">
                      已保存内容与本次提交一致。
                    </p>
                    <Button type="button" onClick={() => saved()}>
                      已核对，完成
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !review.release.etag ||
                      !["draft", "integrating"].includes(review.release.status)
                    }
                    onClick={resume}
                  >
                    已核对，以最新版本继续编辑
                  </Button>
                )}
              </div>
            )}
            {review && "missing" in review && (
              <div className="mt-3 space-y-3">
                <p className="text-[13px] text-muted-foreground">
                  未找到此版本的已保存发布。草稿仍保留，重新提交前请确认。
                </p>
                <Button type="button" variant="outline" onClick={resume}>
                  已核对，允许重新提交
                </Button>
              </div>
            )}
          </section>
        )}
        <fieldset
          disabled={busy || checking || !!blocked || !releaseEditable}
          className="min-w-0 space-y-5"
        >
          {(create || kind === "details") && (
            <Field
              label="发布名称"
              error={errors.fields.name}
              hint="可选，例如「冬季功能发布」。留空时显示版本号；名称不影响 Tag。"
            >
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="为这次发布起一个易识别的名称"
                />
              )}
            </Field>
          )}
          {(create || kind === "details") && (
            <Field
              label="版本号"
              required={editVersion}
              error={errors.fields.version_label}
              hint={
                !editVersion ? "进入合并与备料后，版本号不可修改。" : undefined
              }
            >
              {(props) => (
                <Input
                  {...props}
                  value={version}
                  readOnly={!editVersion}
                  maxLength={96}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="1.4.0"
                  className="font-mono"
                />
              )}
            </Field>
          )}
          {(kind === "settings" || needsPrefix) && (
            <section className="release-prefix-setup">
              {needsPrefix && (
                <p className="mb-4 text-[13px] text-muted-foreground">
                  此产品分支尚未设置 Tag
                  前缀。首次创建时一起保存，后续发布会继续使用。
                </p>
              )}
              <Field
                label="Tag 前缀"
                required
                error={errors.fields.tag_prefix}
                hint="属于当前产品分支，设置后会用于此产品分支后续新发布。"
              >
                {(props) => (
                  <Input
                    {...props}
                    value={prefix}
                    maxLength={96}
                    onChange={(event) => setPrefix(event.target.value)}
                    placeholder="standard-v"
                    className="font-mono"
                  />
                )}
              </Field>
            </section>
          )}
          {create && !variant.release_tag_prefix && savedPrefix && (
            <p className="text-[13px] text-muted-foreground" role="status">
              前缀 <code>{savedPrefix}</code>{" "}
              已保存。发布草稿仍保留，继续后只提交发布。
            </p>
          )}
          {kind !== "description" && (
            <p className="break-all rounded-lg bg-muted px-4 py-3 text-sm">
              <span className="text-muted-foreground">目标 Tag · </span>
              <code>
                {kind === "settings"
                  ? prefix.trim() + "1.4.0"
                  : effectivePrefix + (version.trim() || "1.4.0")}
              </code>
            </p>
          )}
          {(create || kind === "description") && (
            <Field
              label="发布说明"
              error={errors.fields.description_md}
              hint="可选，支持 Markdown，最多 16000 个字符。"
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={create ? 5 : 12}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="本次交付的目标、范围与注意事项"
                />
              )}
            </Field>
          )}
        </fieldset>
      </form>
    </FormDrawer>
  );
}
