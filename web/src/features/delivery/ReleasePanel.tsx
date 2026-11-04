import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useRevalidator,
  useSearchParams,
} from "react-router";
import { ArrowLeft, Tag, Plus, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/platform/native-select";
import { Pagination } from "@/components/platform/pagination";
import { useNavigateAfterSave } from "@/components/platform/navigation-guard";
import { Markdown } from "@/features/collaboration/Markdown";
import type { Variant } from "@/shared/delivery";
import type { ReleaseData } from "./releases";
import { ReleaseEditor } from "./ReleaseEditor";
import { ReleaseMaterials } from "./ReleaseMaterials";
import { ReleaseWorkflow } from "./ReleaseWorkflow";
import { ReleasePreparation } from "./ReleasePreparation";
import {
  releaseDisplayName,
  releaseStatusLabels as status,
  safeProjectReleaseReturn,
} from "./release-labels";
import "./release-workspace.css";
export function ReleasePanel({
  base,
  variant,
  data,
  manage,
  systemAdmin = false,
  readOnlyReason,
}: {
  base: string;
  variant: Variant;
  data: ReleaseData;
  manage: boolean;
  systemAdmin?: boolean;
  readOnlyReason?: string;
}) {
  const [params, setParams] = useSearchParams(),
    location = useLocation(),
    navigate = useNavigate(),
    rv = useRevalidator(),
    afterSave = useNavigateAfterSave();
  const { release: r, materials: set, list } = data;
  const registered =
    data.flow?.changes.filter(
      (change) => !["removed", "reverted"].includes(change.status),
    ) || [];

  const [search, setSearch] = useState(params.get("rq") || "");
  const [cancelTarget, setCancelTarget] = useState<string>();
  const [editor, edit] = useState<
    "settings" | "create" | "description" | "details" | undefined
  >(() =>
    params.get("create") === "1" && manage && !variant.archived_at && !r
      ? "create"
      : undefined,
  );
  useEffect(() => {
    if (!params.has("create")) return;
    const next = new URLSearchParams(params);
    next.delete("create");
    setParams(next, { replace: true });
  }, [params, setParams]);
  function beginCreate() {
    edit("create");
  }
  const path = base + "/releases" + (r ? "/" + r.id : "");
  const projectRoot = location.pathname.split("/variants")[0]!;
  const origin = safeProjectReleaseReturn(params.get("return_to"), projectRoot);
  useEffect(() => {
    if (!cancelTarget || editor) return;
    // Let the dismissed drawer unregister its unsaved guard before navigation.
    const timer = setTimeout(() => {
      void navigate(cancelTarget, { replace: true });
      setCancelTarget(undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, [cancelTarget, editor, navigate]);
  const preparation = (
    <ReleasePreparation
      variant={variant}
      root={projectRoot}
      manage={manage}
      systemAdmin={systemAdmin}
    />
  );
  const returningToOverview =
    origin &&
    new URLSearchParams(origin.split("?")[1]).get("tab") !== "releases";
  const needsAttention = data.flow?.operations[0]?.status === "unknown";
  function href(id?: string, fromList = false) {
    const p = new URLSearchParams(params);
    if (fromList) p.delete("return_to");
    if (id) p.set("release", id);
    else p.delete("release");
    return "?" + p;
  }
  return (
    <section className="release-page">
      {(r || origin) && (
        <Link className="release-back" to={origin || href()}>
          <ArrowLeft />
          {origin
            ? returningToOverview
              ? "返回项目概览"
              : "返回项目发布"
            : `返回${variant.name}发布列表`}
        </Link>
      )}
      {list && (
        <>
          <header
            className="release-index-head"
            aria-label={`${variant.name}的发布`}
          >
            <div>
              <p>
                {variant.name} <span>·</span> <code>{variant.main_branch}</code>
              </p>
            </div>
            {manage && (
              <div className="release-actions">
                {variant.release_tag_prefix && (
                  <Button variant="outline" onClick={() => edit("settings")}>
                    <Tag />
                    Tag 前缀
                  </Button>
                )}
                <Button onClick={beginCreate}>
                  <Plus />
                  创建发布
                </Button>
              </div>
            )}
          </header>
          <div className="release-surface">
            <div className="release-list-toolbar">
              <h2>
                发布记录 <small>{list.total}</small>
              </h2>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const p = new URLSearchParams(params);
                  p.set("rq", search);
                  p.delete("rpage");
                  setParams(p);
                }}
              >
                <Input
                  aria-label="搜索发布名称、版本或 Tag"
                  className="w-64 max-w-full"
                  value={search}
                  placeholder="名称、版本号或 Tag"
                  onChange={(e) => setSearch(e.target.value)}
                />
                <Button size="sm" variant="outline">
                  搜索
                </Button>
                <NativeSelect
                  aria-label="发布状态"
                  className="w-auto"
                  value={params.get("rstatus") || "all"}
                  onChange={(e) => {
                    const p = new URLSearchParams(params);
                    p.set("rstatus", e.target.value);
                    p.delete("rpage");
                    setParams(p);
                  }}
                >
                  <option value="all">全部状态</option>
                  {Object.entries(status).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </NativeSelect>
              </form>
            </div>
            {list.items.length === 0 && (
              <p className="p-6 text-[13px] text-muted-foreground">
                {params.get("rq") ||
                (params.get("rstatus") && params.get("rstatus") !== "all")
                  ? "没有匹配的发布。"
                  : manage
                    ? "此变体尚无发布记录。创建首次发布，开始核对仓库、合并变更与准备交付材料。"
                    : "此变体尚无发布记录。项目管理员创建发布后，可在这里跟踪进展与查看交付材料。"}
              </p>
            )}
            {list.items.length > 0 && (
              <>
                <div
                  className="release-list-row release-list-label"
                  aria-hidden="true"
                >
                  <span>发布</span>
                  <span>目标 Tag</span>
                  <span>发布状态</span>
                  <span>最近更新</span>
                  <span />
                </div>
                {list.items.map((v) => (
                  <Link
                    key={v.id}
                    className="release-list-row"
                    to={href(v.id, true)}
                  >
                    <div className="release-list-name">
                      <strong>{releaseDisplayName(v)}</strong>
                      {v.name?.trim() && v.name.trim() !== v.version_label && (
                        <small>{v.version_label}</small>
                      )}
                    </div>
                    <code>{v.tag_name}</code>
                    <span>
                      <span className="release-status" data-state={v.status}>
                        {status[v.status] || v.status}
                      </span>
                      {v.needs_attention && (
                        <span className="release-attention">结果待核实</span>
                      )}
                    </span>
                    <time dateTime={v.updated_at}>
                      {new Date(v.updated_at).toLocaleDateString()}
                    </time>
                    <ChevronRight aria-hidden="true" />
                  </Link>
                ))}
              </>
            )}
            <Pagination
              total={list.total}
              page={list.page}
              size={list.page_size}
              onChange={(p, n) => {
                const next = new URLSearchParams(params);
                next.set("rpage", String(p));
                next.set("rsize", String(n));
                setParams(next);
              }}
            />
          </div>
        </>
      )}
      {r && set && data.flow && (
        <>
          <header className="release-hero">
            <div className="release-hero-top">
              <div>
                <h1>{releaseDisplayName(r)}</h1>
                <p>
                  {variant.name}
                  {r.name?.trim() && r.name.trim() !== r.version_label && (
                    <>
                      {" "}
                      · <code>{r.version_label}</code>
                    </>
                  )}
                </p>
              </div>
              <div className="release-hero-tools">
                <span className="release-status" data-state={r.status}>
                  {status[r.status] || r.status}
                </span>
                {needsAttention && (
                  <span className="release-attention">结果待核实</span>
                )}
                {manage && ["draft", "integrating"].includes(r.status) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => edit("details")}
                  >
                    <Pencil />
                    编辑资料
                  </Button>
                )}
              </div>
            </div>
            <div className="release-summary">
              <code>{r.tag_name}</code>
              <span>{set.repositories.length} 个仓库</span>
              <span>{registered.length} 项变更</span>
              <span>{set.items.length} 份材料</span>
            </div>
            <details className="release-facts-disclosure">
              <summary>查看版本范围与材料摘要</summary>
              <dl className="release-facts">
                <div>
                  <dt>目标 Tag</dt>
                  <dd>
                    <code>{r.tag_name}</code>
                  </dd>
                </div>
                <div>
                  <dt>版本范围</dt>
                  <dd>{set.repositories.length} 个仓库</dd>
                </div>
                <div>
                  <dt>登记变更</dt>
                  <dd>
                    {new Set(registered.map((change) => change.repo_id)).size}{" "}
                    个仓库
                    <span>
                      {" "}
                      ·{" "}
                      {
                        registered.filter((change) => change.kind === "mr")
                          .length
                      }{" "}
                      项 MR ·{" "}
                      {
                        registered.filter((change) => change.kind === "commit")
                          .length
                      }{" "}
                      项直接提交
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>交付材料</dt>
                  <dd>
                    {set.items.length} 份{" "}
                    <span>
                      · {new Set(set.items.map((i) => i.kind)).size} 类
                    </span>
                  </dd>
                </div>
              </dl>
            </details>
          </header>
          <ReleaseWorkflow
            key={path}
            path={path}
            release={r}
            flow={data.flow}
            set={set}
            readOnlyReason={readOnlyReason}
            scopeHelp={
              <ReleasePreparation
                variant={variant}
                root={projectRoot}
                manage={manage}
                systemAdmin={systemAdmin}
                draftScopeEmpty
              />
            }
            materials={<ReleaseMaterials release={r} path={path} set={set} />}
            notes={
              <>
                <div className="release-section-heading">
                  <div>
                    <h2>发布说明</h2>
                    <p>
                      {variant.name} · {releaseDisplayName(r)}
                    </p>
                  </div>
                  {set.can_edit && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => edit("description")}
                    >
                      编辑说明
                    </Button>
                  )}
                </div>
                {r.description_md ? (
                  <Markdown text={r.description_md} />
                ) : (
                  <p className="release-empty-copy">
                    尚未填写发布说明。可在这里记录变更范围、执行步骤和外部文件链接。
                  </p>
                )}
              </>
            }
          />
        </>
      )}
      {editor && (
        <ReleaseEditor
          key={editor}
          kind={editor}
          r={r}
          base={base}
          variant={variant}
          preparation={preparation}
          close={() => {
            edit(undefined);
            if (editor === "create" && origin) setCancelTarget(origin);
            else void rv.revalidate();
          }}
          saved={(id) => {
            edit(undefined);
            if (id) afterSave(location.pathname + href(id));
            else void rv.revalidate();
          }}
        />
      )}
    </section>
  );
}
