import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { ChevronDown, GitBranch, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery } from "@/lib/use-query";
import { EmptyState, ErrorBox } from "@/components/platform/feedback";
import { FormDrawer } from "@/components/platform/form-drawer";
import { NativeSelect } from "@/components/platform/native-select";
import type { Flow, Command, MaterialSet } from "./releases";
import "./ReleaseChanges.css";

const labels: Record<string, string> = {
  selected: "待处理",
  included: "已纳入",
  reverted: "已回退",
  revert_pending: "待回退",
  removed: "已移出",
};
const historical = (status: string) =>
  status === "removed" || status === "reverted";

export function ReleaseRepositories({
  path,
  flow,
  set,
  status,
  act,
  pending = false,
}: {
  path: string;
  flow: Flow;
  set: MaterialSet;
  status: string;
  act: (op: string, command?: Partial<Command>) => void;
  pending?: boolean;
}) {
  const location = useLocation();
  const [search, setSearch] = useState("");
  const [repository, setRepository] = useState("all");
  const [disposition, setDisposition] = useState("current");
  const [scope, setScope] = useState({ key: "", open: false });
  const scopeButton = useRef<HTMLButtonElement>(null);
  const scopeOpen =
    scope.key === location.key ? scope.open : location.hash === "#scope";
  const [adding, setAdding] = useState(false);
  const [addRepository, setAddRepository] = useState("");
  const [addKind, setAddKind] = useState("mr");
  const manifest = flow.manifests[0],
    q = useQuery<{
      entries: {
        kind: string;
        subject_id: string;
        snapshot: { commit_sha?: string };
      }[];
    }>(manifest ? path + "/manifests/" + manifest.id : null);
  const snapshots = new Map(
    q.data?.entries
      .filter((e) => e.kind === "repository")
      .map((e) => [e.subject_id, e.snapshot.commit_sha]),
  );
  const draft = status === "draft",
    integrating = status === "integrating",
    manage = flow.can_manage;
  const repos = new Map(set.repositories.map((repo) => [repo.id, repo]));
  const current = flow.changes.filter((c) => !historical(c.status));
  const historyCount = flow.changes.length - current.length;
  const missing = set.repositories.filter((repo) => !repo.baseline_sha).length;
  const hasOutside = flow.changes.some((c) => !repos.has(c.repo_id));
  const filtered = flow.changes.filter((c) => {
    const repo = repos.get(c.repo_id);
    const matchesStatus =
      disposition === "all" ||
      (disposition === "current" && !historical(c.status)) ||
      (disposition === "history" && historical(c.status)) ||
      c.status === disposition;
    const matchesRepo =
      repository === "all" ||
      repository === c.repo_id ||
      (repository === "outside" && !repo);
    const text = [repo?.full_path, c.ref, "!" + c.ref, c.evidence.title, c.note]
      .join(" ")
      .toLocaleLowerCase();
    return (
      matchesStatus &&
      matchesRepo &&
      text.includes(search.trim().toLocaleLowerCase())
    );
  });
  const defaultFilter =
    !search.trim() && repository === "all" && disposition === "current";
  useEffect(() => {
    if (location.hash !== "#scope") return;
    scopeButton.current?.focus({ preventScroll: true });
    scopeButton.current?.scrollIntoView?.({ block: "nearest" });
  }, [location.hash, location.key]);

  function openAdd(repoId = "") {
    setAddRepository(
      repoId || (set.repositories.length === 1 ? set.repositories[0].id : ""),
    );
    setAddKind("mr");
    setAdding(true);
  }
  function chooseChange() {
    const repo = repos.get(addRepository);
    if (pending || !set.can_edit || !repo) return;
    if (addKind === "commit" && !(manage && integrating)) return;
    setAdding(false);
    act(addKind === "commit" ? "include-commit" : "select-mr", { repo });
  }
  function clearFilters() {
    setSearch("");
    setRepository("all");
    setDisposition("current");
  }
  return (
    <div className="release-changes-workspace">
      <div className="release-section-heading">
        <div>
          <h2>本次变更</h2>
          <p>
            已登记 {current.length} 项当前变更 · 涉及{" "}
            {new Set(current.map((c) => c.repo_id)).size} 个仓库
            {historyCount > 0 && ` · ${historyCount} 项历史记录`}
          </p>
        </div>
        {set.can_edit && (
          <Button
            size="sm"
            disabled={pending || !set.repositories.length}
            onClick={() => openAdd()}
          >
            <Plus />
            添加变更
          </Button>
        )}
      </div>
      {missing > 0 && (
        <div className="release-baseline-notice">
          <span>
            {missing} 个仓库尚未确认基线
            {draft ? "，开始发布前需要完成核对。" : "。"}
          </span>
          <Button
            variant="link"
            size="sm"
            onClick={() => {
              setScope({ key: location.key, open: true });
              scopeButton.current?.focus({ preventScroll: true });
              scopeButton.current?.scrollIntoView?.({ block: "nearest" });
            }}
          >
            查看待确认仓库
          </Button>
        </div>
      )}
      {flow.changes.length > 0 && (
        <div className="release-change-filters">
          <Input
            aria-label="搜索本次变更"
            placeholder="搜索 MR、提交、标题或仓库"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <NativeSelect
            aria-label="按仓库筛选变更"
            value={repository}
            onChange={(e) => setRepository(e.target.value)}
          >
            <option value="all">全部仓库</option>
            {set.repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.full_path}
              </option>
            ))}
            {hasOutside && (
              <option value="outside">已移出发布范围的仓库</option>
            )}
          </NativeSelect>
          <NativeSelect
            aria-label="按处理状态筛选变更"
            value={disposition}
            onChange={(e) => setDisposition(e.target.value)}
          >
            <option value="current">全部当前变更</option>
            <option value="selected">待处理</option>
            <option value="included">已纳入</option>
            <option value="revert_pending">待回退</option>
            <option value="history">历史记录（已移出 / 已回退）</option>
            <option value="all">全部记录</option>
          </NativeSelect>
        </div>
      )}
      {filtered.length === 0 ? (
        <EmptyState
          title={defaultFilter ? "本次尚未登记代码变更" : "没有匹配的变更"}
          description={
            defaultFilter
              ? set.repositories.length
                ? "发布可以只包含材料，无需为每个仓库添加 MR。未登记变更不代表远端没有新增提交，送验前仍会核对全部范围仓库。"
                : "当前发布范围没有仓库，可先准备材料。开始发布前需补充仓库范围并确认基线；检查变体仓库配置后刷新范围。"
              : "试试其他仓库、处理状态或搜索词。"
          }
          action={
            defaultFilter ? (
              historyCount > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setDisposition("history")}
                >
                  查看历史记录
                </Button>
              ) : undefined
            ) : (
              <Button size="sm" variant="outline" onClick={clearFilters}>
                清除筛选
              </Button>
            )
          }
        />
      ) : (
        <>
          <p className="release-change-count" role="status">
            显示 {filtered.length} 项
            {disposition === "history" ? "历史记录" : "变更"}
          </p>
          <ul className="release-changes-list" aria-label="已登记变更">
            {filtered.map((c) => {
              const repo = repos.get(c.repo_id);
              const history = historical(c.status);
              const revert =
                !!repo && !history && manage && integrating && !c.reverted_by;
              const remove =
                !!repo && manage && set.can_edit && c.status === "selected";
              return (
                <li
                  key={c.id}
                  className="release-change-item"
                  data-history={history || undefined}
                >
                  <div className="release-change-main">
                    <div className="release-change-title">
                      <span className="release-change-kind">
                        {c.kind === "mr"
                          ? `MR !${c.ref}`
                          : `提交 ${c.ref.slice(0, 10)}`}
                      </span>
                      <strong>
                        {c.evidence.title ||
                          (c.kind === "mr" ? "已登记的合并请求" : "直接提交")}
                      </strong>
                    </div>
                    <div className="release-change-context">
                      <span>{repo?.full_path || "已移出发布范围的仓库"}</span>
                      {repo && <code>{repo.main_branch}</code>}
                    </div>
                    {(c.note || c.kind === "commit" || c.reverted_by) && (
                      <details className="release-change-detail">
                        <summary>查看详情</summary>
                        {c.kind === "commit" && (
                          <p>
                            完整提交 SHA <code>{c.ref}</code>
                          </p>
                        )}
                        {c.note && <p>{c.note}</p>}
                        {c.reverted_by && (
                          <p>已关联回退记录 #{c.reverted_by}</p>
                        )}
                      </details>
                    )}
                  </div>
                  <span className="release-change-state" data-state={c.status}>
                    {labels[c.status] || c.status}
                  </span>
                  <div className="release-actions">
                    {repo &&
                      integrating &&
                      manage &&
                      c.kind === "mr" &&
                      c.status === "selected" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() => act("merge", { repo, change: c })}
                        >
                          合并 MR
                        </Button>
                      )}
                    {(revert || remove) && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            disabled={pending}
                            aria-label={`${repo?.full_path || c.repo_id} · ${c.kind === "mr" ? "MR !" : "提交 "}${c.ref} 更多变更操作`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {revert && (
                            <DropdownMenuItem
                              onSelect={() =>
                                act("link-revert", { repo, change: c })
                              }
                            >
                              关联回退 MR
                            </DropdownMenuItem>
                          )}
                          {revert &&
                            (c.kind === "commit" ||
                              c.evidence.state === "merged") && (
                              <DropdownMenuItem
                                onSelect={() =>
                                  act("create-revert", { repo, change: c })
                                }
                              >
                                创建回退 MR
                              </DropdownMenuItem>
                            )}
                          {remove && (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                act("remove-change", { change: c })
                              }
                            >
                              移出变更
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <section id="release-scope" className="release-scope">
        <button
          ref={scopeButton}
          type="button"
          className="release-scope-toggle"
          aria-expanded={scopeOpen}
          aria-controls="release-scope-content"
          onClick={() => setScope({ key: location.key, open: !scopeOpen })}
        >
          <ChevronDown aria-hidden="true" />
          <span>版本范围与基线 · {set.repositories.length} 个仓库</span>
          <small>{missing ? `${missing} 项待确认` : "查看全部范围"}</small>
        </button>
        {scopeOpen && (
          <div id="release-scope-content" className="release-scope-content">
            <div className="release-section-heading">
              <p>
                范围来自变体配置。即使未登记
                MR，仓库仍会参与基线核对、版本快照和归档 Tag。
              </p>
              {manage && draft && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => act("refresh-scope")}
                >
                  刷新范围
                </Button>
              )}
            </div>
            {q.error && (
              <ErrorBox>
                {q.error}{" "}
                <Button size="sm" variant="link" onClick={q.refresh}>
                  重试读取快照
                </Button>
              </ErrorBox>
            )}
            {!set.repositories.length && (
              <p className="release-empty-copy">
                当前发布未包含仓库。可调整变体范围后刷新。
              </p>
            )}
            <ul className="release-scope-list" aria-label="发布范围仓库">
              {set.repositories.map((repo) => (
                <li key={repo.id} className="release-scope-item">
                  <div className="release-scope-repo">
                    <strong>
                      <GitBranch aria-hidden="true" />
                      {repo.full_path}
                    </strong>
                    <span>
                      <code>{repo.main_branch}</code> · 已登记{" "}
                      {current.filter((c) => c.repo_id === repo.id).length}{" "}
                      项当前变更
                    </span>
                    <details className="release-change-detail">
                      <summary>查看基线与快照</summary>
                      <dl>
                        <div>
                          <dt>基线 SHA</dt>
                          <dd>
                            {repo.baseline_sha ? (
                              <code>{repo.baseline_sha}</code>
                            ) : (
                              "尚未确认"
                            )}
                          </dd>
                        </div>
                        {manifest && (
                          <div>
                            <dt>清单 #{manifest.sequence_no}</dt>
                            <dd>
                              {q.loading ? (
                                "读取中…"
                              ) : q.error ? (
                                "快照读取失败"
                              ) : (
                                <code>
                                  {snapshots.get(repo.id) || "无已核实快照"}
                                </code>
                              )}
                            </dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </div>
                  <span
                    className="release-scope-baseline"
                    data-missing={!repo.baseline_sha || undefined}
                  >
                    {repo.baseline_sha ? "基线已确认" : "基线待确认"}
                  </span>
                  <div className="release-actions">
                    {draft && manage && (
                      <Button
                        variant={repo.baseline_sha ? "ghost" : "outline"}
                        size="sm"
                        disabled={pending}
                        onClick={() => act("baseline", { repo })}
                      >
                        {repo.baseline_sha ? "调整基线" : "确认基线"}
                      </Button>
                    )}
                    {set.can_edit && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() => openAdd(repo.id)}
                        aria-label={`为 ${repo.full_path} 添加变更`}
                      >
                        添加变更
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      {adding && (
        <FormDrawer
          size="compact"
          title="添加本次变更"
          description="选择本次确有代码变更的仓库。其他范围仓库无需逐一添加 MR。"
          onClose={() => setAdding(false)}
          footer={(cancel) => (
            <>
              <Button variant="outline" onClick={() => cancel()}>
                取消
              </Button>
              <Button
                type="submit"
                form="choose-release-change"
                disabled={pending || !addRepository || !set.can_edit}
              >
                {addKind === "commit" ? "填写直接提交" : "选择 MR"}
              </Button>
            </>
          )}
        >
          <form
            id="choose-release-change"
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              chooseChange();
            }}
          >
            <label className="block space-y-2 text-sm">
              <span>所属仓库</span>
              <NativeSelect
                required
                disabled={pending}
                value={addRepository}
                onChange={(e) => setAddRepository(e.target.value)}
              >
                <option value="">选择发布范围内的仓库</option>
                {set.repositories.map((repo) => (
                  <option key={repo.id} value={repo.id}>
                    {repo.full_path} · {repo.main_branch}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="block space-y-2 text-sm">
              <span>变更类型</span>
              <NativeSelect
                disabled={pending}
                value={addKind}
                onChange={(e) => setAddKind(e.target.value)}
              >
                <option value="mr">MR（合并请求）</option>
                {manage && integrating && (
                  <option value="commit">直接提交</option>
                )}
              </NativeSelect>
            </label>
            <p className="release-empty-copy">
              {addKind === "commit"
                ? "补录已进入主干的完整提交 SHA，并说明纳入本次发布的原因。"
                : "查看指向此仓库主干的待合并 MR，也可通过编号登记已合并的 MR。"}
            </p>
            {manage && draft && (
              <p className="release-empty-copy">开始发布后，可补录直接提交。</p>
            )}
          </form>
        </FormDrawer>
      )}
    </div>
  );
}
