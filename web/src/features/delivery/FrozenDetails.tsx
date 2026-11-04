import { useState } from "react";
import { request, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { FormDrawer } from "@/components/platform/form-drawer";
import { ErrorBox } from "@/components/platform/feedback";
import { groups, type Kind } from "./releases";
type Entry = {
  kind: string;
  subject_id: string;
  revision_id?: string;
  sort_order: number;
  snapshot: {
    full_path?: string;
    main_branch?: string;
    commit_sha?: string;
    baseline_sha?: string;
    filename?: string;
    kind?: Kind;
    target_path?: string;
    database_name?: string;
    revision_no?: number;
    ref?: string;
    status?: string;
  };
};
export function FrozenDetails({
  path,
  id,
  sequence,
}: {
  path: string;
  id: string;
  sequence: number;
}) {
  const [open, show] = useState(false),
    [rows, setRows] = useState<Entry[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    show(true);
    setBusy(true);
    setError("");
    try {
      setRows(
        (await request<{ entries: Entry[] }>(path + "/manifests/" + id)).data
          .entries,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void load()}
      >
        查看冻结清单
      </Button>
      {open && (
        <FormDrawer
          title={"清单 #" + sequence}
          description="查看送验时的仓库主干提交和材料修订。"
          onClose={() => show(false)}
          footer={(close) => <Button onClick={() => close()}>关闭</Button>}
        >
          {error && <ErrorBox>{error}</ErrorBox>}
          {busy ? (
            <p>读取中…</p>
          ) : (
            <>
              <section>
                <h3 className="font-semibold">仓库快照</h3>
                {rows
                  .filter((v) => v.kind === "repository")
                  .map((v) => (
                    <div
                      key={v.subject_id}
                      className="mt-2 rounded-lg border p-3 text-sm"
                    >
                      <b>
                        {v.snapshot.full_path} · {v.snapshot.main_branch}
                      </b>
                      <p className="break-all font-mono">
                        基线 {v.snapshot.baseline_sha}
                      </p>
                      <p className="break-all font-mono">
                        送验 {v.snapshot.commit_sha}
                      </p>
                    </div>
                  ))}
              </section>
              <section>
                <h3 className="font-semibold">变更记录</h3>
                {!rows.some((v) => v.kind === "change") && (
                  <p className="text-sm">本次无代码变更。</p>
                )}
                {rows
                  .filter((v) => v.kind === "change")
                  .map((v) => (
                    <p className="break-all text-sm" key={v.subject_id}>
                      {v.snapshot.kind} {v.snapshot.ref} ·{" "}
                      {v.snapshot.status === "reverted" ? "已回退" : "已纳入"}
                    </p>
                  ))}
              </section>
              {(Object.keys(groups) as Kind[]).map((k) => {
                const list = rows.filter(
                  (v) => v.kind === "item" && v.snapshot.kind === k,
                );
                return (
                  list.length > 0 && (
                    <section key={k}>
                      <h3 className="font-semibold">
                        {groups[k]} · {list.length} 份
                      </h3>
                      {list.map((v) => (
                        <div
                          className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm"
                          key={v.subject_id}
                        >
                          <span>
                            {k === "sql" ? v.sort_order + ". " : ""}
                            {v.snapshot.filename} · 修订{" "}
                            {v.snapshot.revision_no}
                          </span>
                          <a
                            className="underline"
                            href={
                              "/api/v1" +
                              path +
                              "/items/" +
                              v.subject_id +
                              "/revisions/" +
                              v.revision_id +
                              "/file"
                            }
                            download
                          >
                            下载
                          </a>
                        </div>
                      ))}
                    </section>
                  )
                );
              })}
            </>
          )}
        </FormDrawer>
      )}
    </>
  );
}
