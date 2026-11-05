import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { request } from "@/api/client";
import { Button, IconButton } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { StandaloneInput } from "@/components/fields";
import { Modal } from "@/components/overlays";
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
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const candidates = useApiQuery<Page<Resource>>(
    ["shortcut-candidates", kind, submitted],
    `/${kind}?scope=mine&status=all&page_size=100&q=${encodeURIComponent(submitted)}`,
  );
  const selected = useMemo(
    () =>
      ids
        .map(
          (id) =>
            group.items.find((item) => item.id === id) ??
            candidates.data?.data.items.find((item) => item.id === id),
        )
        .filter((item) => item !== undefined),
    [ids, group.items, candidates.data],
  );
  const dirty =
    JSON.stringify(ids) !== JSON.stringify(group.items.map((item) => item.id));
  const title = kind === "projects" ? "管理关注项目" : "管理固定团队";
  async function save() {
    const ok = await submission.run(() =>
      request(`/me/sidebar-shortcuts/${kind}`, {
        method: "PUT",
        etag: group.etag,
        body: { ids },
      }).then(() => undefined),
    );
    if (ok) {
      await queryClient.invalidateQueries({ queryKey: ["shortcuts"] });
      onClose();
    }
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
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            pending={submission.pending}
            disabled={!dirty}
            onClick={() => void save()}
          >
            保存顺序与选择
          </Button>
        </>
      }
    >
      <ErrorNotice error={submission.error} />
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
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <IconButton
                  size="iconSm"
                  label={`上移 ${item.name}`}
                  disabled={index === 0}
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
                  disabled={index === ids.length - 1}
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
      <section className="mt-6 border-t pt-5">
        <h3 className="mb-3 text-sm font-medium">添加可参与对象</h3>
        <form
          className="mb-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(query.trim());
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
        <ul className="grid max-h-56 gap-1 overflow-y-auto">
          {candidates.data?.data.items
            .filter((item) => !ids.includes(item.id))
            .map((item) => (
              <li key={item.id}>
                <button
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover"
                  onClick={() => setIds([...ids, item.id])}
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
      </section>
    </Modal>
  );
}
