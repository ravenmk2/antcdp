import { useState } from "react";
import { request, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/components/platform/form-drawer";
import { Pagination } from "@/components/platform/pagination";
import { ErrorBox } from "@/components/platform/feedback";
import type { Page } from "@/shared/delivery";
import { fileURL, type Material } from "./releases";
export function MaterialHistory({
  path,
  item,
}: {
  path: string;
  item?: string;
}) {
  const [open, show] = useState(false),
    [rows, setRows] = useState<Page<Material>>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(page: number, size: number) {
    show(true);
    setBusy(true);
    setError("");
    try {
      setRows(
        (
          await request<Page<Material>>(
            path +
              (item ? "/items/" + item + "/revisions" : "/removed-items") +
              "?page=" +
              page +
              "&page_size=" +
              size,
          )
        ).data,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const title = item ? "修订历史" : "已移出的材料";
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => void load(1, 20)}
      >
        {title}
      </Button>
      {open && (
        <FormDrawer
          title={title}
          description="各修订保留保存时的原件和目标信息。"
          onClose={() => show(false)}
          footer={(close) => (
            <Button variant="outline" onClick={() => close()}>
              关闭
            </Button>
          )}
        >
          {error && <ErrorBox>{error}</ErrorBox>}
          {busy && <p role="status">读取中…</p>}
          {rows && !busy && (
            <>
              {rows.items.length === 0 && <p>暂无记录。</p>}
              {rows.items.map((m) => (
                <div key={m.revision_id} className="border-b pb-3">
                  <b className="break-all">{m.filename}</b> · 修订{" "}
                  {m.revision_no}
                  <p className="break-all text-sm">
                    {m.target_path || m.database_name} {m.description_md}
                  </p>
                  <a
                    className="text-sm underline"
                    href={fileURL(path, m)}
                    download
                  >
                    下载此修订
                  </a>
                  {!item && <MaterialHistory path={path} item={m.id} />}
                </div>
              ))}
              <Pagination
                page={rows.page}
                size={rows.page_size}
                total={rows.total}
                onChange={(p, n) => void load(p, n)}
              />
            </>
          )}
        </FormDrawer>
      )}
    </>
  );
}
