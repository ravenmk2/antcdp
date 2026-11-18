import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  isVersionConflict,
  request,
  type ApiError,
  type ApiResponse,
} from "@/api/client";
import { Button } from "@/components/button";
import {
  Field,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { useNavigationGuard } from "@/components/navigation-guard";
import { Pagination } from "@/components/pagination";
import { useApiQuery } from "@/hooks/use-api";
import { agentAdminRoot, agentKeys } from "../data/agent-api";
import { objectJSON, ResourceSection } from "./admin-shared";

interface PapiGrant {
  api_code: string;
  title: string;
  summary: string;
  effect: "read" | "write" | "";
  available: boolean;
  granted: boolean;
  parameter_constraints_text: string;
}

interface ChangeGrant {
  code: string;
  etag: string;
  constraints?: string;
}

export function AgentPapiGrants({
  agentId,
  readOnly,
  onSaved,
}: {
  agentId: string;
  readOnly: boolean;
  onSaved: () => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [granted, setGranted] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [editor, setEditor] = useState<{
    code: string;
    text: string;
    etag: string;
  } | null>(null);
  const [validationError, setValidationError] = useState("");
  const endpoint = `${agentAdminRoot}/definitions/${agentId}/papi-grants`;
  const params = new URLSearchParams({
    page: String(page),
    page_size: String(size),
  });
  if (search.trim()) params.set("q", search.trim());
  if (granted) params.set("granted", granted);
  const query = useApiQuery<PapiGrant[]>(
    [...agentKeys, agentId, "papi-grants", page, size, search.trim(), granted],
    `${endpoint}?${params}`,
  );
  const save = useMutation<ApiResponse<null>, ApiError, ChangeGrant>({
    mutationFn: ({ code, etag, constraints }: ChangeGrant) =>
      request<null>(`${endpoint}/${encodeURIComponent(code)}`, {
        etag,
        method: constraints === undefined ? "DELETE" : "PUT",
        rawJSON:
          constraints === undefined
            ? undefined
            : `{"parameter_constraints":${constraints}}`,
      }),
    onSuccess: async () => {
      setEditor(null);
      await onSaved();
    },
  });
  useNavigationGuard(Boolean(editor) || save.isPending);
  const constraintError =
    editor &&
    save.error?.details.some(
      (detail) => detail.field === "parameter_constraints",
    )
      ? "参数限制的 JSON Schema 无效，请检查字段类型和校验规则。"
      : "";

  function change(item: PapiGrant, constraints?: string) {
    if (!query.data?.etag) return;
    save.mutate({ code: item.api_code, etag: query.data.etag, constraints });
  }

  function saveLimits() {
    if (!editor) return;
    try {
      objectJSON(editor.text);
      setValidationError("");
      save.mutate({
        code: editor.code,
        etag: editor.etag,
        constraints: editor.text,
      });
    } catch {
      setValidationError("请输入有效的 JSON 对象。");
    }
  }

  return (
    <ResourceSection
      title="平台 API 授权"
      description="为当前智能体逐项授权。工具开关在「内置工具」中配置，授权变更在下一轮执行时生效。"
    >
      <div className="flex flex-wrap gap-2">
        <StandaloneInput
          aria-label="搜索平台 API"
          placeholder="搜索操作代码或用途"
          maxLength={64}
          value={search}
          disabled={Boolean(editor) || save.isPending}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
        <StandaloneSelect
          aria-label="平台 API 授权状态"
          value={granted}
          disabled={Boolean(editor) || save.isPending}
          onValueChange={(value) => {
            setGranted(value);
            setPage(1);
          }}
        >
          <option value="">全部授权状态</option>
          <option value="true">已授权</option>
          <option value="false">未授权</option>
        </StandaloneSelect>
      </div>
      {save.isError && !constraintError && <ErrorNotice error={save.error} />}
      {save.isError &&
        (isVersionConflict(save.error) || save.error.status === 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditor(null);
              save.reset();
              void query.refetch();
            }}
          >
            重新加载授权
          </Button>
        )}
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {query.data?.data.length === 0 && <Notice>暂无匹配的平台 API。</Notice>}
        <ul className="divide-y divide-border-subtle">
          {query.data?.data.map((item) => (
            <li key={item.api_code} className="space-y-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <h3 className="font-medium">
                    {item.title}{" "}
                    <code className="break-all text-xs text-muted">
                      {item.api_code}
                    </code>
                  </h3>
                  {item.summary && (
                    <p className="text-sm text-muted">{item.summary}</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone={item.granted ? "success" : "neutral"}>
                      {item.granted ? "已授权" : "未授权"}
                    </StatusBadge>
                    {!item.available && (
                      <StatusBadge tone="warning">操作已下架</StatusBadge>
                    )}
                    {item.effect && (
                      <StatusBadge>
                        {item.effect === "read" ? "只读" : "写入"}
                      </StatusBadge>
                    )}
                  </div>
                </div>
                {!readOnly && (
                  <div className="flex flex-wrap gap-2">
                    {item.granted && item.available && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(editor) || save.isPending}
                        onClick={() => {
                          save.reset();
                          setValidationError("");
                          setEditor({
                            code: item.api_code,
                            text: item.parameter_constraints_text,
                            etag: query.data!.etag,
                          });
                        }}
                      >
                        编辑参数限制
                      </Button>
                    )}
                    {item.granted ? (
                      <Button
                        type="button"
                        variant="dangerSoft"
                        size="sm"
                        disabled={Boolean(editor) || save.isPending}
                        onClick={() => change(item)}
                      >
                        撤销授权
                      </Button>
                    ) : (
                      item.available && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={Boolean(editor) || save.isPending}
                          onClick={() => change(item, "{}")}
                        >
                          授权
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>
              {editor?.code === item.api_code ? (
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveLimits();
                  }}
                >
                  <Field
                    label="参数限制"
                    error={validationError || constraintError}
                    hint={
                      '填写参数 JSON Schema，例如 {"args_schema":{"required":["message"]}}。清除限制可保存空对象。'
                    }
                  >
                    <Textarea
                      className="font-mono"
                      value={editor.text}
                      onChange={(event) => {
                        setEditor({ ...editor, text: event.target.value });
                        setValidationError("");
                        if (constraintError) save.reset();
                      }}
                      rows={5}
                      disabled={save.isPending}
                    />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={save.isPending}>
                      保存参数限制
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={save.isPending}
                      onClick={() => {
                        setEditor(null);
                        save.reset();
                      }}
                    >
                      取消
                    </Button>
                  </div>
                </form>
              ) : (
                item.granted &&
                item.parameter_constraints_text !== "{}" && (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted">
                      参数限制
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-all text-xs">
                      {item.parameter_constraints_text}
                    </pre>
                  </details>
                )
              )}
            </li>
          ))}
        </ul>
        <Pagination
          page={page}
          size={size}
          total={query.data?.pagination?.total}
          pending={query.isFetching || save.isPending || Boolean(editor)}
          onChange={(next, count) => {
            setPage(next);
            setSize(count);
          }}
        />
      </AsyncBoundary>
    </ResourceSection>
  );
}
