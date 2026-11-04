import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { Scope, Page, Repository } from "@/shared/delivery";
import { matchSources } from "@/shared/delivery";
import { useQuery } from "@/lib/use-query";
import { request, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination } from "@/components/platform/pagination";
import { AsyncState, ErrorBox } from "@/components/platform/feedback";

export function ScopeEditor({
  projectId,
  variantId,
  environment = false,
  connections,
  value,
  onChange,
  disabled = false,
  controlProps,
}: {
  projectId: string;
  variantId?: string;
  environment?: boolean;
  connections: { id: string; name: string }[];
  value: Scope;
  onChange: (scope: Scope) => void;
  disabled?: boolean;
  controlProps?: Pick<
    ComponentProps<"select">,
    "id" | "aria-describedby" | "aria-invalid"
  >;
}) {
  const [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const signature = JSON.stringify({
    projectId,
    variantId,
    environment,
    value,
  });
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const sequence = useRef(0),
    controller = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<
    { signature: string; data: Page<Repository> } | undefined
  >();
  const base = environment
    ? `/projects/${projectId}/variants/${variantId}/repositories`
    : `/projects/${projectId}/repositories`;
  const repositories = useQuery<Page<Repository>>(
    value.mode === "custom" ? `${base}?page=${page}&page_size=${size}` : null,
  );
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  function change(next: Scope) {
    controller.current?.abort();
    sequence.current++;
    setBusy(false);
    setError("");
    setResult(undefined);
    onChange(next);
  }
  async function preview(p = 1, n = 20) {
    if (disabled) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const run = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const r = await request<Page<Repository>>(
        `/projects/${projectId}/repository-scope-preview?page=${p}&page_size=${n}`,
        {
          method: "POST",
          signal: abort.signal,
          body: {
            variant_id: variantId,
            subject_kind: environment ? "environment" : "variant",
            repository_scope: value,
          },
        },
      );
      if (run === sequence.current && signature === currentSignature.current)
        setResult({ signature, data: r.data });
    } catch (e) {
      if (
        !abort.signal.aborted &&
        run === sequence.current &&
        signature === currentSignature.current
      )
        setError(errorMessage(e));
    } finally {
      if (run === sequence.current && !abort.signal.aborted) setBusy(false);
    }
  }
  const shown = result?.signature === signature ? result.data : undefined;
  const selectClass =
    "h-[var(--control-height)] w-full rounded-md border bg-background px-3 text-sm";
  return (
    <section aria-label="仓库范围" className="space-y-4">
      <select
        {...controlProps}
        aria-label="仓库范围模式"
        className={selectClass}
        value={value.mode}
        disabled={disabled}
        onChange={(e) =>
          change({ mode: e.target.value, repository_ids: [], rules: [] })
        }
      >
        <option value={environment ? "inherit" : "all"}>
          {environment ? "继承产品分支全部仓库" : "全部项目仓库"}
        </option>
        <option value="custom">自定义范围</option>
      </select>
      {value.mode === "custom" ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              手动选择与规则匹配取并集
              {environment ? "，并限制在产品分支范围内" : ""}。已选择{" "}
              {value.repository_ids.length} 个。
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !value.repository_ids.length}
              onClick={() => change({ ...value, repository_ids: [] })}
            >
              清空手动选择
            </Button>
          </div>
          <AsyncState
            loading={repositories.loading}
            error={repositories.error}
            empty={!repositories.data?.items.length}
            onRetry={repositories.refresh}
          >
            <Table aria-label="手动选择仓库">
              <TableHeader>
                <TableRow>
                  <TableHead>选择</TableHead>
                  <TableHead>仓库</TableHead>
                  <TableHead>服务连接</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.data?.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={r.full_path}
                        disabled={disabled}
                        checked={value.repository_ids.includes(r.id)}
                        onCheckedChange={(checked) =>
                          change({
                            ...value,
                            repository_ids: checked
                              ? [...value.repository_ids, r.id]
                              : value.repository_ids.filter(
                                  (id) => id !== r.id,
                                ),
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>{r.full_path}</TableCell>
                    <TableCell>{r.connection_name}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </AsyncState>
          {repositories.data && (
            <Pagination
              page={page}
              size={size}
              total={repositories.data.total}
              pending={repositories.loading}
              onChange={(p, n) => {
                setPage(p);
                setSize(n);
              }}
            />
          )}
          {environment && (
            <p className="text-xs text-muted-foreground">
              父范围缩小时，原手动项可能失效。请重新选择范围内的仓库；原选择不会静默删除。
            </p>
          )}
          <details open={value.rules.length > 0} className="space-y-3">
            <summary className="cursor-pointer text-sm font-medium">
              按规则匹配（高级） · {value.rules.length} 条
            </summary>
            {value.rules.map((rule, index) => (
              <div
                key={index}
                className="grid items-start gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_100px_1.5fr_auto]"
              >
                <select
                  aria-label={`规则 ${index + 1} 服务连接`}
                  className={selectClass}
                  value={rule.connection_id || "all"}
                  disabled={disabled}
                  onChange={(e) =>
                    change({
                      ...value,
                      rules: value.rules.map((r, i) =>
                        i === index
                          ? {
                              ...r,
                              connection_id:
                                e.target.value === "all"
                                  ? null
                                  : e.target.value,
                            }
                          : r,
                      ),
                    })
                  }
                >
                  <option value="all">全部项目连接</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  {rule.connection_id &&
                    !connections.some((c) => c.id === rule.connection_id) && (
                      <option value={rule.connection_id}>
                        原连接（当前无关联仓库）
                      </option>
                    )}
                </select>
                <select
                  aria-label={`规则 ${index + 1} 类型`}
                  className={selectClass}
                  value={rule.mode}
                  disabled={disabled}
                  onChange={(e) =>
                    change({
                      ...value,
                      rules: value.rules.map((r, i) =>
                        i === index ? { ...r, mode: e.target.value } : r,
                      ),
                    })
                  }
                >
                  <option value="glob">通配符</option>
                  <option value="regex">正则</option>
                </select>
                <Input
                  aria-label={`规则 ${index + 1} 路径`}
                  placeholder="group/**"
                  disabled={disabled}
                  value={rule.pattern}
                  onChange={(e) =>
                    change({
                      ...value,
                      rules: value.rules.map((r, i) =>
                        i === index ? { ...r, pattern: e.target.value } : r,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() =>
                    change({
                      ...value,
                      rules: value.rules.filter((_, i) => i !== index),
                    })
                  }
                >
                  移除规则
                </Button>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              匹配完整仓库路径，区分大小写；失效连接规则可原样保留。
            </p>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || value.rules.length >= 20}
              onClick={() =>
                change({
                  ...value,
                  rules: [
                    ...value.rules,
                    { connection_id: null, mode: "glob", pattern: "" },
                  ],
                })
              }
            >
              添加规则
            </Button>
          </details>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {environment ? "跟随产品分支范围" : "包含全部项目关联仓库"}
          ，仓库变化后自动更新。
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => void preview()}
      >
        {busy ? "正在预览…" : "预览匹配范围"}
      </Button>
      <ErrorBox>{error}</ErrorBox>
      {shown && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm font-medium">当前匹配 {shown.total} 个仓库</p>
          <p className="text-xs text-muted-foreground">
            仅计算当前草稿范围，未保存配置，也未访问远端。
          </p>
          <Table aria-label="仓库范围预览">
            <TableHeader>
              <TableRow>
                <TableHead>仓库</TableHead>
                <TableHead>范围来源</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.full_path}</TableCell>
                  <TableCell>{matchSources(r.match_sources)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!shown.items.length && (
            <p className="text-sm text-muted-foreground">没有匹配仓库。</p>
          )}
          <Pagination
            page={shown.page}
            size={shown.page_size}
            total={shown.total}
            pending={busy}
            onChange={(p, n) => void preview(p, n)}
          />
        </div>
      )}
    </section>
  );
}
