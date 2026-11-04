import { ConfigPreview } from "./ConfigPreview";
import { useRef, useState, useEffect } from "react";
import {
  ChevronDown,
  Database,
  FileCode2,
  Paperclip,
  PackageOpen,
  Plus,
  Download,
} from "lucide-react";
import { useRevalidator } from "react-router";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorBox } from "@/components/platform/feedback";
import { Markdown } from "@/features/collaboration/Markdown";
import { request, errorMessage } from "@/lib/api";
import {
  groups,
  fileURL,
  type Release,
  type MaterialSet,
  type Material,
  type Kind,
} from "./releases";
import { MaterialDrawer } from "./ReleaseMaterialDrawer";
import { MaterialHistory } from "./MaterialHistory";
import { releaseDisplayName } from "./release-labels";

const icons = {
  sql: Database,
  object: PackageOpen,
  config: FileCode2,
  attachment: Paperclip,
};
const kinds = Object.keys(groups) as Kind[];
function ConfigExcerpt({ url }: { url: string }) {
  const [text, setText] = useState<string>(),
    [failed, fail] = useState(false);
  useEffect(() => {
    const ac = new AbortController();
    void fetch(url, { signal: ac.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const s = await r.text();
        if (!ac.signal.aborted) setText(s);
      })
      .catch(() => {
        if (!ac.signal.aborted) fail(true);
      });
    return () => ac.abort();
  }, [url]);
  if (failed) return <ErrorBox>配置预览不可用，请通过下载文件重试。</ErrorBox>;
  if (text === undefined) return <p role="status">读取配置…</p>;
  return (
    <ConfigPreview
      text={
        text.length > 6000
          ? text.slice(0, 6000) + "\n… 完整内容见下载文件"
          : text
      }
    />
  );
}
function MaterialRow({
  m,
  index,
  count,
  path,
  set,
  busy,
  edit,
  move,
}: {
  m: Material;
  index: number;
  count: number;
  path: string;
  set: MaterialSet;
  busy: boolean;
  edit: () => void;
  move: (d: number) => void;
}) {
  const [open, expand] = useState(false),
    repo = set.repositories.find((v) => v.id === m.repository_id)?.full_path;
  const target = [
    m.database_name && "数据库 " + m.database_name,
    m.bucket_name && "Bucket " + m.bucket_name,
    m.target_path,
    repo && "仓库 " + repo,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <details
      className="release-file"
      onToggle={(e) => expand(e.currentTarget.open)}
    >
      <summary>
        <ChevronDown className="release-disclosure" />
        <span className="min-w-0">
          {m.kind === "sql" && (
            <span className="release-order">
              {String(m.sql_position).padStart(2, "0")}
            </span>
          )}
          <strong>{m.filename}</strong>
          <small className="release-revision">修订 {m.revision_no}</small>
          {target && <span className="release-target">{target}</span>}
        </span>
      </summary>
      {open && (
        <div className="release-file-body">
          {m.description_md && <Markdown text={m.description_md} />}
          {m.kind === "config" && (
            <ConfigExcerpt key={m.revision_id} url={fileURL(path, m)} />
          )}
          <small className="release-hash">
            {m.size_bytes.toLocaleString()} B · SHA-256 <code>{m.sha256}</code>
          </small>
          <div className="release-actions">
            <Button asChild size="sm" variant="outline">
              <a href={fileURL(path, m)} download={m.filename}>
                <Download />
                下载文件
              </a>
            </Button>
            {set.can_edit && (
              <Button size="sm" variant="ghost" onClick={edit}>
                编辑材料
              </Button>
            )}
            <MaterialHistory path={path} item={m.id} />
            {set.can_edit && m.kind === "sql" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || index === 0}
                  onClick={() => move(-1)}
                >
                  上移
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || index === count - 1}
                  onClick={() => move(1)}
                >
                  下移
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </details>
  );
}
export function ReleaseMaterials({
  release: r,
  path,
  set,
}: {
  release: Release;
  path: string;
  set: MaterialSet;
}) {
  const [item, edit] = useState<{ kind: Kind; value?: Material }>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    rv = useRevalidator();
  async function reorder(m: Material, step: number) {
    if (lock.current) return;
    const ids = set.items.filter((i) => i.kind === "sql").map((i) => i.id),
      i = ids.indexOf(m.id),
      j = i + step;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await request(path + "/sql-order", {
        method: "PUT",
        etag: r.etag,
        body: { item_ids: ids },
      });
      await rv.revalidate();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="release-section-heading">
        <div>
          <h2>交付材料</h2>
          <p>SQL 按编号执行，跨类别步骤见发布说明。</p>
        </div>
        <div className="release-actions">
          {set.can_edit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus />
                  添加材料
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {kinds.map((k) => (
                  <DropdownMenuItem key={k} onSelect={() => edit({ kind: k })}>
                    {groups[k]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {set.items.length === 0 && (
        <div className="release-empty">
          <PackageOpen />
          <h3>尚无交付材料</h3>
          <p>
            {set.can_edit
              ? "添加数据库脚本、对象存储文件、配置或附件后，会在这里按类型整理。"
              : "此版本没有交付材料。"}
          </p>
        </div>
      )}
      {kinds.map((k) => {
        const rows = set.items.filter((m) => m.kind === k),
          Icon = icons[k];
        return (
          rows.length > 0 && (
            <section className="release-group" key={k} aria-label={groups[k]}>
              <h3>
                <Icon />
                {groups[k]}
                <small>{rows.length} 份</small>
              </h3>
              {rows.map((m, n) => (
                <MaterialRow
                  key={m.id}
                  path={path}
                  set={set}
                  m={m}
                  index={n}
                  count={rows.length}
                  busy={busy}
                  edit={() => edit({ kind: k, value: m })}
                  move={(step) => void reorder(m, step)}
                />
              ))}
            </section>
          )
        );
      })}
      <div className="release-material-history">
        <MaterialHistory path={path} />
      </div>
      {item && (
        <MaterialDrawer
          path={path}
          etag={r.etag}
          kind={item.kind}
          value={item.value}
          repos={set.repositories}
          releaseName={releaseDisplayName(r)}
          close={() => edit(undefined)}
          saved={() => {
            edit(undefined);
            void rv.revalidate();
          }}
        />
      )}
    </>
  );
}
