import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { AsyncBoundary, ErrorNotice } from "@/components/feedback";
import { StandaloneInput } from "@/components/fields";
import { Modal, OverlayCancelButton } from "@/components/overlays";
import { Pagination } from "@/components/pagination";
import { ResourceIcon } from "@/components/resource-icon";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import type {
  Page,
  Resource,
  ResourceKind,
  Shortcuts,
} from "@/types/collaboration";

export function ShortcutEditor({
  kind,
  initial,
  onClose,
}: {
  kind: ResourceKind;
  initial: Shortcuts;
  onClose: () => void;
}) {
  const group = initial[kind];
  const [ids, setIds] = useState(group.items.map((item) => item.id));
  const [added, setAdded] = useState<Record<string, Resource>>({});
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateSize, setCandidateSize] = useState(20);
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const candidates = useApiQuery<Page<Resource>>(
    ["shortcut-candidates", kind, submitted, candidatePage, candidateSize],
    `/${kind}?${new URLSearchParams({
      scope: "mine",
      status: "all",
      page: String(candidatePage),
      page_size: String(candidateSize),
      q: submitted,
    })}`,
  );
  const selected = useMemo(
    () =>
      ids
        .map((id) => group.items.find((item) => item.id === id) ?? added[id])
        .filter((item) => item !== undefined),
    [ids, group.items, added],
  );
  const dirty =
    JSON.stringify(ids) !== JSON.stringify(group.items.map((item) => item.id));
  const title = kind === "projects" ? "管理关注项目" : "管理固定团队";
  const available =
    candidates.data?.data.items.filter((item) => !ids.includes(item.id)) ?? [];

  async function save() {
    const ok = await submission.run(() =>
      request(`/me/sidebar-shortcuts/${kind}`, {
        method: "PUT",
        etag: group.etag,
        body: { ids },
      }).then(() => undefined),
    );
    await queryClient.invalidateQueries({ queryKey: ["shortcuts"] });
    if (ok) onClose();
  }

  return (
    <Modal
      open
      wide
      title={title}
      description="调整仅影响你的个人入口；关注项目不会开启消息通知。"
      dirty={dirty}
      pending={submission.pending}
      onClose={onClose}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            pending={submission.pending}
            disabled={!dirty || submission.uncertain}
            onClick={() => void save()}
          >
            保存顺序与选择
          </Button>
        </>
      }
    >
      <ErrorNotice error={submission.error} />
      {submission.uncertain && (
        <Button
          className="mt-3"
          variant="outline"
          size="sm"
          onClick={() => submission.setError(null)}
        >
          已读取最新快捷方式，继续核对草稿
        </Button>
      )}
      <section>
        <h3 className="mb-3 text-sm font-medium">已选择 · {ids.length}</h3>
        {selected.length ? (
          <ul className="grid gap-2">
            {selected.map((item, index) => (
              <li
                key={item.id}
                className="flex items-center gap-2 rounded-lg border p-2"
              >
                <ResourceIcon resource={item} className="size-8" />
                <span className="min-w-0 flex-1 break-all">{item.name}</span>
                <IconButton
                  size="iconSm"
                  label={`上移 ${item.name}`}
                  disabled={submission.pending || index === 0}
                  onClick={() => {
                    const next = [...ids];
                    const current = next[index];
                    const previous = next[index - 1];
                    if (current !== undefined && previous !== undefined) {
                      next[index - 1] = current;
                      next[index] = previous;
                      setIds(next);
                    }
                  }}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  size="iconSm"
                  label={`下移 ${item.name}`}
                  disabled={submission.pending || index === ids.length - 1}
                  onClick={() => {
                    const next = [...ids];
                    const current = next[index];
                    const following = next[index + 1];
                    if (current !== undefined && following !== undefined) {
                      next[index] = following;
                      next[index + 1] = current;
                      setIds(next);
                    }
                  }}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  size="iconSm"
                  label={`移除 ${item.name}`}
                  disabled={submission.pending}
                  onClick={() => setIds(ids.filter((id) => id !== item.id))}
                >
                  <X />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-surface-subtle p-4 text-sm text-muted">
            尚未选择任何项目或团队。
          </p>
        )}
      </section>
      <section className="mt-6 border-t border-t-border-subtle pt-5">
        <h3 className="mb-3 text-sm font-medium">添加可参与对象</h3>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query.trim());
            setCandidatePage(1);
          }}
        >
          <StandaloneInput
            aria-label="搜索可添加对象"
            placeholder="搜索名称或编码"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>
        <AsyncBoundary
          loading={candidates.isPending}
          error={candidates.error}
          onRetry={() => void candidates.refetch()}
          empty={!available.length}
          emptyTitle={
            candidates.data?.data.total
              ? "本页对象均已选择"
              : "没有可添加的对象"
          }
          emptyDescription="可调整搜索关键词或翻页查看。"
        >
          <ul className="grid max-h-56 gap-1 overflow-y-auto">
            {available.map((item) => (
              <li key={item.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover"
                  disabled={submission.pending}
                  onClick={() => {
                    setAdded((current) => ({ ...current, [item.id]: item }));
                    setIds([...ids, item.id]);
                  }}
                >
                  <ResourceIcon resource={item} className="size-8" />
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm">{item.name}</strong>
                    <small className="text-muted">{item.code}</small>
                  </span>
                  <Plus className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </AsyncBoundary>
        {candidates.data && candidates.data.data.total > 0 && (
          <Pagination
            page={candidatePage}
            size={candidateSize}
            total={candidates.data.data.total}
            pending={candidates.isFetching}
            onChange={(nextPage, nextSize) => {
              setCandidatePage(nextPage);
              setCandidateSize(nextSize);
            }}
          />
        )}
      </section>
    </Modal>
  );
}
