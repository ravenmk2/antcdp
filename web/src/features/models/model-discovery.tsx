import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { StandaloneInput, StandaloneSelect } from "@/components/fields";
import { ErrorNotice, Notice, StatusBadge } from "@/components/feedback";
import { ModelEditor } from "./model-editor";
import { modelKeys, modelRequest } from "./model-api";
import { protocolNames } from "./model-shared";
import type {
  ModelProvider,
  ProviderType,
  ModelProtocol,
  ModelSummary,
} from "@/types/models";

type Discovered = { model_id: string; display_name: string | null };
type Progress = "pending" | "saved" | "failed" | "unknown";
export function ModelDiscoveryResults({
  provider,
  type,
  models,
}: {
  provider: ModelProvider;
  type: ProviderType;
  models: Discovered[];
}) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [protocol, setProtocol] = useState<ModelProtocol>(
    type.protocols.find((item) => item.available)?.protocol ??
      "chat_completions",
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [active, setActive] = useState<string | null>(null);
  const existing = useQuery({
    queryKey: [...modelKeys, "discovery-existing", provider.id, protocol],
    queryFn: async ({ signal }) => {
      const items: ModelSummary[] = [];
      for (let page = 1; ; page++) {
        const response = await modelRequest<ModelSummary[]>(
          `/definitions?provider_id=${provider.id}&protocol=${protocol}&page=${page}&page_size=100`,
          { signal },
        );
        items.push(...response.data);
        if (
          !response.data.length ||
          items.length >= (response.pagination?.total ?? items.length)
        )
          return items;
      }
    },
    retry: false,
  });
  const known = new Set(existing.data?.map((item) => item.model_id));
  const rows = models
    .filter(
      (model, index) =>
        models.findIndex((item) => item.model_id === model.model_id) === index,
    )
    .filter((model) =>
      `${model.model_id} ${model.display_name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const available = rows.filter(
    (model) =>
      !known.has(model.model_id) && progress[model.model_id] !== "saved",
  );
  const seed = models.find((model) => model.model_id === active);
  function start(ids: string[]) {
    const pending = ids.filter(
      (id) => !known.has(id) && progress[id] !== "saved",
    );
    setQueue(pending);
    setActive(pending[0] ?? null);
  }
  function saved() {
    if (!active) return;
    setProgress((current) => ({ ...current, [active]: "saved" }));
    setSelected((current) => current.filter((id) => id !== active));
    const next = queue.slice(queue.indexOf(active) + 1);
    setActive(next[0] ?? null);
    void client.invalidateQueries({
      queryKey: modelKeys,
    });
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <StandaloneInput
          aria-label="搜索发现的模型"
          placeholder="搜索远端模型 ID 或名称"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <StandaloneSelect
          aria-label="添加模型的协议"
          value={protocol}
          onValueChange={(value) => {
            setProtocol(value as ModelProtocol);
            setSelected([]);
            setProgress({});
            setQueue([]);
          }}
        >
          {type.protocols
            .filter((item) => item.available)
            .map((item) => (
              <option key={item.protocol} value={item.protocol}>
                {protocolNames[item.protocol]}
              </option>
            ))}
        </StandaloneSelect>
        <Button
          disabled={
            !selected.length || existing.isPending || Boolean(existing.error)
          }
          onClick={() => start(selected)}
        >
          配置所选 {selected.length || ""} 个
        </Button>
      </div>
      <p className="text-xs text-muted">
        逐项确认能力、上下文与输出限制后保存。已添加状态仅对应所选协议。
      </p>
      <ErrorNotice error={existing.error} />
      {existing.error && (
        <Button variant="outline" onClick={() => void existing.refetch()}>
          重新读取已添加模型
        </Button>
      )}
      {existing.isPending && (
        <p className="text-sm text-muted">正在核对已添加模型…</p>
      )}
      {queue.length > 0 && (
        <Notice>
          本轮已添加 {queue.filter((id) => progress[id] === "saved").length} /{" "}
          {queue.length} 个；未完成项可继续配置。
          {queue.some((id) => progress[id] === "unknown") &&
            "存在结果未知的条目，请先刷新核对服务器记录。"}
        </Notice>
      )}
      <div className="max-h-96 overflow-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface-subtle">
            <tr>
              <th className="w-10 p-3">
                <input
                  type="checkbox"
                  aria-label="选择当前筛选下可添加的模型"
                  disabled={
                    existing.isPending ||
                    Boolean(existing.error) ||
                    !available.length
                  }
                  checked={
                    available.length > 0 &&
                    available.every((model) =>
                      selected.includes(model.model_id),
                    )
                  }
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [
                            ...new Set([
                              ...current,
                              ...available.map((model) => model.model_id),
                            ]),
                          ]
                        : current.filter(
                            (id) =>
                              !available.some((model) => model.model_id === id),
                          ),
                    )
                  }
                />
              </th>
              <th className="p-3 font-medium">远端模型</th>
              <th className="p-3 font-medium">添加状态</th>
              <th className="p-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((model) => {
              const id = model.model_id;
              const added = known.has(id) || progress[id] === "saved";
              return (
                <tr
                  key={id}
                  className="border-t border-border-subtle hover:bg-table-row-hover"
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${id}`}
                      checked={selected.includes(id)}
                      disabled={
                        added || existing.isPending || Boolean(existing.error)
                      }
                      onChange={(event) =>
                        setSelected((current) =>
                          event.target.checked
                            ? [...current, id]
                            : current.filter((item) => item !== id),
                        )
                      }
                    />
                  </td>
                  <td className="p-3">
                    <span className="break-all font-mono">{id}</span>
                    {model.display_name && model.display_name !== id && (
                      <p className="text-xs text-muted">{model.display_name}</p>
                    )}
                  </td>
                  <td className="p-3">
                    <StatusBadge
                      tone={
                        added
                          ? "success"
                          : progress[id] === "failed" ||
                              progress[id] === "unknown"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {added
                        ? "已添加"
                        : progress[id] === "failed"
                          ? "保存失败"
                          : progress[id] === "unknown"
                            ? "待核实"
                            : existing.isPending || existing.error
                              ? "待核对"
                              : "待配置"}
                    </StatusBadge>
                  </td>
                  <td className="p-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={
                        added || existing.isPending || Boolean(existing.error)
                      }
                      onClick={() => start([id])}
                    >
                      配置并添加
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted">
                  没有匹配的远端模型
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {seed && (
        <ModelEditor
          key={`${protocol}:${seed.model_id}`}
          provider={provider}
          type={type}
          seed={{ ...seed, protocol }}
          onClose={() => setActive(null)}
          onSaved={saved}
          onOutcome={(state) =>
            setProgress((current) => ({
              ...current,
              [seed.model_id]: state,
            }))
          }
        />
      )}
    </div>
  );
}
