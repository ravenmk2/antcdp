import { ConfigPreview } from "./ConfigPreview";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/platform/native-select";
import { FormDrawer } from "@/components/platform/form-drawer";
import { ErrorBox } from "@/components/platform/feedback";
import { request, errorMessage } from "@/lib/api";
import { writeOutcomeUnknown, writeRequiresReview } from "@/lib/write-error";
import { CopyButton } from "@/components/platform/copy-button";
import {
  fileURL,
  groups,
  type Material,
  type Kind,
  type MaterialSet,
} from "./releases";
const label = "block space-y-1 text-sm font-medium";
type MaterialReview = {
  set: MaterialSet;
  etag: string;
  candidates: Material[];
  content?: string;
};
type MaterialDraft = Pick<
  Material,
  | "filename"
  | "description_md"
  | "repository_id"
  | "database_name"
  | "bucket_name"
  | "target_path"
  | "config_format"
  | "config_mode"
>;
function MaterialComparison({
  stored,
  draft,
  repos,
  kind,
  fileChanged,
}: {
  stored: Material;
  draft: MaterialDraft;
  repos: MaterialSet["repositories"];
  kind: Kind;
  fileChanged: boolean;
}) {
  const repository = (id: string) =>
    repos.find((item) => item.id === id)?.full_path || id || "不关联仓库";
  const fields: [string, string, string][] = [
    [
      "文件",
      kind === "config" || fileChanged ? draft.filename : "沿用最新已保存文件",
      stored.filename,
    ],
    ["说明", draft.description_md, stored.description_md],
  ];
  if (kind !== "attachment")
    fields.push([
      "仓库",
      repository(draft.repository_id),
      repository(stored.repository_id),
    ]);
  if (kind === "sql")
    fields.push(["数据库", draft.database_name, stored.database_name]);
  if (kind === "object")
    fields.push(["Bucket", draft.bucket_name, stored.bucket_name]);
  if (kind === "object" || kind === "config")
    fields.push(["目标路径", draft.target_path, stored.target_path]);
  if (kind === "config")
    fields.push(
      ["格式", draft.config_format, stored.config_format],
      [
        "交付方式",
        draft.config_mode === "full" ? "完整文件" : "配置增量",
        stored.config_mode === "full" ? "完整文件" : "配置增量",
      ],
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed text-left text-[13px]">
        <thead>
          <tr>
            <th className="w-16 py-2 font-medium">字段</th>
            <th className="px-2 py-2 font-medium">当前草稿</th>
            <th className="px-2 py-2 font-medium">已保存</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([name, local, remote]) => (
            <tr key={name} className="border-t align-top">
              <th className="py-2 font-normal text-muted-foreground">{name}</th>
              <td className="whitespace-pre-wrap break-all px-2 py-2">
                {local || "未填写"}
              </td>
              <td className="whitespace-pre-wrap break-all px-2 py-2">
                {remote || "未填写"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function MaterialDrawer({
  path,
  etag,
  kind,
  value,
  repos,
  releaseName,
  close,
  saved,
}: {
  path: string;
  etag: string;
  kind: Kind;
  value?: Material;
  repos: MaterialSet["repositories"];
  releaseName?: string;
  close: () => void;
  saved: () => void;
}) {
  const [target, setTarget] = useState(value?.target_path || ""),
    [bucket, setBucket] = useState(value?.bucket_name || ""),
    [db, setDB] = useState(value?.database_name || ""),
    [repo, setRepo] = useState(value?.repository_id || ""),
    [fmt, setFmt] = useState(value?.config_format || "yaml"),
    [mode, setMode] = useState(value?.config_mode || "delta"),
    [description, describe] = useState(value?.description_md || "");
  const [file, setFile] = useState<File>(),
    [content, setContent] = useState(""),
    [original, setOriginal] = useState(""),
    [ready, setReady] = useState(!value || kind !== "config"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState(false);
  const lock = useRef(false);
  const [writeTag, setWriteTag] = useState(etag),
    [baseline, setBaseline] = useState(value),
    [availableRepos, setAvailableRepos] = useState(repos),
    [blocked, setBlocked] = useState<{ remove: boolean; unknown: boolean }>(),
    [review, setReview] = useState<MaterialReview>(),
    [checking, setChecking] = useState(false),
    [reviewError, setReviewError] = useState("");
  const reviewLock = useRef(false);
  useEffect(() => {
    if (!value || kind !== "config") return;
    const ac = new AbortController();
    void fetch(fileURL(path, value), { signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const s = await r.text();
        if (!ac.signal.aborted) {
          setContent(s);
          setOriginal(s);
          setReady(true);
        }
      })
      .catch(() => {
        if (!ac.signal.aborted) setError("读取配置原文失败，请关闭后重试。");
      });
    return () => ac.abort();
  }, [path, kind, value]);
  const dirty =
    !!file ||
    content !== original ||
    target !== (baseline?.target_path || "") ||
    db !== (baseline?.database_name || "") ||
    bucket !== (baseline?.bucket_name || "") ||
    repo !== (baseline?.repository_id || "") ||
    description !== (baseline?.description_md || "") ||
    fmt !== (baseline?.config_format || "yaml") ||
    mode !== (baseline?.config_mode || "delta");
  const missingRepository =
    !!repo && !availableRepos.some((item) => item.id === repo);
  const filename =
    kind === "config"
      ? target.split("/").at(-1) || ""
      : file?.name || baseline?.filename || "";
  const draft = {
    filename,
    description_md: description,
    repository_id: repo,
    database_name: db,
    bucket_name: bucket,
    target_path: target,
    config_format: kind === "config" ? fmt : "",
    config_mode: kind === "config" ? mode : "",
  };
  const draftCopy = [
    `文件：${filename}`,
    `仓库：${availableRepos.find((item) => item.id === repo)?.full_path || repo || "未关联"}`,
    db && `数据库：${db}`,
    bucket && `Bucket：${bucket}`,
    target && `目标路径：${target}`,
    kind === "config" && `格式：${fmt} · ${mode}`,
    description && `说明：\n${description}`,
    kind === "config" && `配置内容：\n${content}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  async function save(remove: boolean) {
    if (lock.current || blocked || checking) return;
    if (!remove && missingRepository) {
      setError("原关联仓库已移出发布范围，请重新选择仓库或选择不关联仓库。");
      return;
    }
    if (!remove && file && file.size > 100 * 1024 * 1024) {
      setError(
        "单个文件不能超过 100 MiB。大文件可在 Markdown 说明中记录链接。",
      );
      return;
    }
    if (!remove && kind === "config" && fmt === "json") {
      try {
        JSON.parse(content);
      } catch (e) {
        setError("JSON 语法错误：" + String(e));
        return;
      }
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const endpoint = path + "/items" + (value ? "/" + value.id : "");
      if (remove) {
        await request(endpoint, { method: "DELETE", etag: writeTag });
      } else {
        const data = new FormData();
        data.set(
          "metadata",
          JSON.stringify({
            kind,
            filename,
            description_md: description,
            database_name: db,
            bucket_name: bucket,
            repository_id: repo,
            target_path: target,
            config_format: kind === "config" ? fmt : "",
            config_mode: kind === "config" ? mode : "",
          }),
        );
        if (
          kind === "config" &&
          (!value ||
            original !== content ||
            fmt !== baseline?.config_format ||
            mode !== baseline?.config_mode)
        ) {
          data.set(
            "file",
            new Blob([content], { type: "text/plain;charset=utf-8" }),
            filename,
          );
        } else if (file) data.set("file", file);
        await request(endpoint, {
          method: value ? "PATCH" : "POST",
          etag: writeTag,
          body: data,
        });
      }
      saved();
    } catch (e) {
      setError(errorMessage(e));
      if (writeRequiresReview(e)) {
        setBlocked({ remove, unknown: writeOutcomeUnknown(e) });
        setReview(undefined);
        setReviewError("");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function checkLatest() {
    if (reviewLock.current || !blocked) return;
    reviewLock.current = true;
    setChecking(true);
    setReview(undefined);
    setReviewError("");
    try {
      const response = await request<MaterialSet>(path + "/items");
      if (!response.etag) throw new Error("missing_material_version");
      const candidates = value
        ? response.data.items.filter((item) => item.id === value.id)
        : response.data.items.filter(
            (item) =>
              item.kind === kind &&
              (item.filename === filename ||
                (!!target && item.target_path === target)),
          );
      let latestContent: string | undefined;
      if (value && kind === "config" && candidates[0]) {
        const response = await fetch(fileURL(path, candidates[0]), {
          cache: "no-store",
        });
        if (!response.ok) throw new Error("material_file_unavailable");
        latestContent = await response.text();
      }
      setReview({
        set: response.data,
        etag: response.etag,
        candidates,
        content: latestContent,
      });
    } catch (e) {
      setReviewError(errorMessage(e));
    } finally {
      reviewLock.current = false;
      setChecking(false);
    }
  }
  function resume() {
    if (
      !review?.etag ||
      !review.set.can_edit ||
      (value && !review.candidates[0])
    )
      return;
    setWriteTag(review.etag);
    setAvailableRepos(review.set.repositories);
    if (value) {
      setBaseline(review.candidates[0]);
      if (kind === "config") setOriginal(review.content || "");
    }
    setBlocked(undefined);
    setReview(undefined);
    setError("");
  }
  return (
    <FormDrawer
      title={(value ? "编辑" : "添加") + groups[kind]}
      description={
        (releaseName ? releaseName + " · " : "") +
        (value ? "修改后保存为新的材料修订。" : "材料将加入当前发布。")
      }
      onClose={close}
      dirty={dirty || !!blocked}
      pending={busy || checking}
      footer={(cancel) => (
        <>
          {value && (
            <Button
              variant="ghost"
              disabled={busy || checking || !!blocked}
              onClick={() => setRemoving(true)}
            >
              移出清单
            </Button>
          )}
          <Button variant="outline" onClick={() => cancel()}>
            取消
          </Button>
          <Button
            form="material-form"
            type="submit"
            disabled={busy || checking || !!blocked || !ready || removing}
          >
            保存材料
          </Button>
        </>
      )}
    >
      <form
        id="material-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        {error && <ErrorBox>{error}</ErrorBox>}
        {blocked && (
          <section
            className="space-y-4 rounded-lg border p-4"
            aria-label="材料保存结果核对"
          >
            <ErrorBox tone="warning">
              {blocked.unknown
                ? "提交结果尚未确认。文件和文字草稿已保留，请先核实已保存记录，避免重复提交。"
                : "发布已更新。当前文件和文字草稿已保留，请先对照最新材料，再决定如何保存。"}
            </ErrorBox>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={checking}
                onClick={() => void checkLatest()}
              >
                {checking ? "正在读取…" : "读取最新材料"}
              </Button>
              <CopyButton value={draftCopy} label="复制文字草稿" />
            </div>
            <ErrorBox>{reviewError}</ErrorBox>
            {review && (
              <>
                {!review.set.can_edit && (
                  <ErrorBox tone="warning">
                    当前发布或父对象已只读，无法继续保存。可复制草稿并查看已保存材料。
                  </ErrorBox>
                )}
                {value && !review.candidates.length ? (
                  <>
                    <p className="text-sm">
                      此材料已不在当前清单中。为避免重新加入已移出的材料，本次不再重试写入。
                    </p>
                    <Button type="button" variant="outline" onClick={saved}>
                      已核对，返回材料列表
                    </Button>
                  </>
                ) : (
                  <>
                    {!value && (
                      <p className="text-sm text-muted-foreground">
                        {review.candidates.length
                          ? "找到同名或同目标材料，请核对文件和资料是否属于本次上传。"
                          : "当前清单未找到同名或同目标材料。核对后才能重新提交草稿。"}
                      </p>
                    )}
                    {review.candidates.map((item) => (
                      <section
                        key={item.id}
                        className="space-y-3 rounded-md border p-3"
                        aria-label={`已保存材料 ${item.filename}`}
                      >
                        <p className="break-all text-sm font-medium">
                          {item.filename} · 修订 {item.revision_no}
                        </p>
                        <MaterialComparison
                          stored={item}
                          draft={draft}
                          repos={review.set.repositories}
                          kind={kind}
                          fileChanged={!!file}
                        />
                        <p className="break-all text-[13px] text-muted-foreground">
                          {item.size_bytes.toLocaleString()} B · SHA-256{" "}
                          {item.sha256}
                        </p>
                        <a
                          className="inline-flex text-sm underline"
                          href={fileURL(path, item)}
                          download
                        >
                          下载已保存修订
                        </a>
                        {value &&
                          kind === "config" &&
                          review.content !== undefined && (
                            <div className="grid gap-3 sm:grid-cols-2">
                              <details open>
                                <summary className="text-sm font-medium">
                                  当前配置草稿
                                </summary>
                                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-[13px]">
                                  {content}
                                </pre>
                              </details>
                              <details open>
                                <summary className="text-sm font-medium">
                                  已保存配置内容
                                </summary>
                                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-[13px]">
                                  {review.content}
                                </pre>
                              </details>
                            </div>
                          )}
                        {!value && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={saved}
                          >
                            已核对，使用此已保存材料
                          </Button>
                        )}
                      </section>
                    ))}
                    {review.set.can_edit && (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          {blocked.remove
                            ? "继续后仍需确认移出，已保存的历史修订会保留。"
                            : value
                              ? kind === "config"
                                ? "继续后保留当前完整配置和资料草稿。再次保存会将草稿内容生成新修订；远端新增或修改的内容不会自动合并，请先核对。"
                                : "继续后保留当前资料和所选文件；未选择替换文件时沿用最新已保存文件。再次保存会生成新修订。"
                              : "只有确认现有记录不是本次上传结果时，才继续新增。当前文件和文字草稿会保留。"}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={resume}
                        >
                          {blocked.remove
                            ? "已核对，继续移出"
                            : value
                              ? "已核对，保留草稿继续编辑"
                              : "已核对，仍需新增材料"}
                        </Button>
                      </div>
                    )}
                    {value && (
                      <Button type="button" variant="ghost" onClick={saved}>
                        采用已保存版本并关闭
                      </Button>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        )}
        <fieldset
          disabled={busy || checking || !!blocked}
          className="min-w-0 space-y-4"
        >
          {kind !== "config" && (
            <label className={label}>
              {value ? "替换文件（可选）" : "上传文件"}
              <Input
                type="file"
                required={!value}
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <small className="text-muted-foreground">
                {baseline?.filename} 单文件最多 100 MiB
              </small>
            </label>
          )}
          {kind !== "attachment" && (
            <label className={label}>
              关联仓库
              <NativeSelect
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
              >
                <option value="">不关联仓库</option>
                {missingRepository && (
                  <option value={repo} disabled>
                    原关联仓库已移出范围，请重新选择
                  </option>
                )}
                {availableRepos.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_path}
                  </option>
                ))}
              </NativeSelect>
            </label>
          )}
          {kind === "sql" && (
            <label className={label}>
              数据库名
              <Input value={db} onChange={(e) => setDB(e.target.value)} />
            </label>
          )}
          {(kind === "object" || kind === "config") && (
            <label className={label}>
              {kind === "object" ? "目标对象路径" : "目标配置相对路径"}
              <Input
                required
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder={
                  kind === "object"
                    ? "templates/report.csv"
                    : "config/application.yaml"
                }
              />
            </label>
          )}
          {kind === "object" && (
            <label className={label}>
              Bucket（可选）
              <Input
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
              />
            </label>
          )}
          {kind === "config" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={label}>
                  文件格式
                  <NativeSelect
                    value={fmt}
                    onChange={(e) => setFmt(e.target.value)}
                  >
                    {["yaml", "toml", "json", "ini", "properties"].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </NativeSelect>
                </label>
                <label className={label}>
                  交付方式
                  <NativeSelect
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="delta">配置增量</option>
                    <option value="full">完整文件</option>
                  </NativeSelect>
                </label>
              </div>
              <label className={label}>
                配置内容
                <Textarea
                  className="font-mono"
                  rows={9}
                  spellCheck={false}
                  disabled={!ready}
                  required
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
              </label>
              <small>
                增量保留完整键路径，由交付程序合并。在线配置原文最多 1 MiB。
              </small>
              {content && (
                <details>
                  <summary className="cursor-pointer text-sm">语法预览</summary>
                  <ConfigPreview text={content} />
                </details>
              )}
            </>
          )}
          <label className={label}>
            材料说明（Markdown）
            <Textarea
              value={description}
              rows={4}
              onChange={(e) => describe(e.target.value)}
            />
          </label>
        </fieldset>
      </form>
      {removing && (
        <div className="rounded-md border p-3 text-sm">
          <p>将「{baseline?.filename}」移出本次清单？已保存修订将保留。</p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="outline"
              disabled={busy || checking || !!blocked}
              onClick={() => setRemoving(false)}
            >
              保留
            </Button>
            <Button
              variant="destructive"
              disabled={busy || checking || !!blocked}
              onClick={() => void save(true)}
            >
              确认移出
            </Button>
          </div>
        </div>
      )}
    </FormDrawer>
  );
}
