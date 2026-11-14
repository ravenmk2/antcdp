import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ApiError, isVersionConflict, request } from "@/api/client";
import { CodeBlock } from "@/components/code-block";
import { WandSparkles, Braces, Play, Plug } from "lucide-react";
import { Button } from "@/components/button";
import { Field, StandaloneSelect, Textarea } from "@/components/fields";
import {
  EmptyState,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import { agentAdminRoot } from "@/features/agents/data/agent-api";
import type {
  MCPServer,
  MCPTestResult,
  MCPCallResult,
  MCPDiagnostic,
  MCPExample,
} from "@/types/agent-resources";

const statusLabel = {
  succeeded: "调用成功",
  failed: "调用失败",
  outcome_unknown: "结果未知",
};
export function MCPDebugWorkspace({
  server,
  etag,
  onRefresh,
  autoConnect = false,
}: {
  server: MCPServer;
  etag: string;
  onRefresh: () => void;
  autoConnect?: boolean;
}) {
  const path = agentAdminRoot + "/mcp-servers/" + server.id;
  const latest = useApiQuery<{ latest: MCPDiagnostic | null }>(
    ["agent-resources", "mcp", server.id, "diagnostics"],
    path + "/diagnostics",
  );
  const [test, setTest] = useState<MCPTestResult>();
  const [session, setSession] = useState<{ id: string; expires: number }>();
  const sessionRef = useRef<string | undefined>(undefined);
  const [now, setNow] = useState(Date.now());
  const [example, setExample] = useState<MCPExample>();
  const [language, setLanguage] = useState("auto");
  const automatic = useRef(false);
  function remember(id?: string, expires?: string) {
    sessionRef.current = id;
    setSession(
      id
        ? { id, expires: expires ? Date.parse(expires) : Date.now() + 600000 }
        : undefined,
    );
  }
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, []);
  const [selected, setSelected] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    name: string;
    value: MCPCallResult;
  }>();
  const [pending, setPending] = useState<
    "test" | "call" | "example" | "disconnect" | null
  >(null);
  const [error, setError] = useState<unknown>();
  const [verified, setVerified] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const argsInput = useRef<HTMLTextAreaElement | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      const id = sessionRef.current;
      if (id)
        void request(path + "/debug-sessions/" + id, {
          method: "DELETE",
        }).catch(() => {});
    },
    [path],
  );
  const tool = test?.tools.find((v) => v.name === selected);
  const outdated = Boolean(
    test &&
    (test.server_version !== server.version || test.diagnostic.outdated),
  );
  const connected = Boolean(session && session.expires > now && !outdated);
  const diagnostic = test?.diagnostic ?? latest.data?.data.latest;
  const args = drafts[selected] ?? "{}";
  const unknown = result?.value.status === "outcome_unknown" && !verified;
  const tools = test?.tools ?? [];
  async function run(kind: "test" | "call" | "example" | "disconnect") {
    if (controller.current) return;
    let parsed: unknown;
    if (kind === "call") {
      try {
        parsed = JSON.parse(args);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
          throw new Error("参数必须是 JSON 对象。");
        if (new TextEncoder().encode(args).length > 32768)
          throw new Error("参数不能超过 32 KiB。");
      } catch (e) {
        setError(e);
        argsInput.current?.focus();
        return;
      }
      if (!tool || !connected || unknown) return;
    }
    const active = new AbortController();
    controller.current = active;
    setPending(kind);
    setError(undefined);
    try {
      if (kind === "disconnect") {
        if (sessionRef.current)
          await request(path + "/debug-sessions/" + sessionRef.current, {
            method: "DELETE",
            signal: active.signal,
          });
        remember();
        return;
      }
      if (kind === "example") {
        if (!tool || !connected) return;
        const response = await request<MCPExample>(
          path + "/example-arguments",
          {
            method: "POST",
            etag,
            signal: active.signal,
            body: {
              session_id: sessionRef.current,
              tool_name: tool.name,
              definition_fingerprint: tool.definition_fingerprint,
            },
          },
        );
        setExample(response.data);
        remember(sessionRef.current);
        return;
      }
      if (kind === "test") {
        if (!connected && sessionRef.current) {
          await request(path + "/debug-sessions/" + sessionRef.current, {
            method: "DELETE",
            signal: active.signal,
          });
          remember();
        }
        const response = await request<MCPTestResult>(
          path + "/debug-sessions",
          {
            method: "POST",
            etag,
            body: connected ? { session_id: sessionRef.current } : {},
            signal: active.signal,
          },
        );
        setTest(response.data);
        remember(response.data.session_id, response.data.expires_at);
        setExample(undefined);
        setSelected((current) =>
          response.data.tools.some((t) => t.name === current)
            ? current
            : (response.data.tools[0]?.name ?? ""),
        );
        void latest.refetch();
      } else {
        const response = await request<MCPCallResult>(path + "/call-tool", {
          method: "POST",
          etag,
          body: {
            session_id: sessionRef.current,
            tool_name: tool!.name,
            definition_fingerprint: tool!.definition_fingerprint,
            arguments: parsed,
          },
          signal: active.signal,
        });
        setResult({ name: tool!.name, value: response.data });
        remember(
          response.data.session_active === false
            ? undefined
            : sessionRef.current,
        );
        setVerified(false);
      }
    } catch (e) {
      setError(e);
      if (
        e instanceof ApiError &&
        (e.code === "MCP_DEBUG_EXPIRED" || isVersionConflict(e))
      )
        remember();
      if (
        kind === "call" &&
        (!(e instanceof ApiError) || e.uncertain || active.signal.aborted)
      ) {
        setResult({
          name: tool!.name,
          value: {
            status: "outcome_unknown",
            executed: null,
            duration_ms: 0,
            content: "未收到完整响应。请在远端核实执行结果后再决定是否重试。",
            structured_content: null,
            truncated: false,
            error: null,
          },
        });
        setVerified(false);
        remember();
      }
    } finally {
      controller.current = null;
      setPending(null);
    }
  }
  const startAutomatic = useEffectEvent(() => {
    void run("test");
  });
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active && autoConnect && !automatic.current) {
        automatic.current = true;
        startAutomatic();
      }
    });
    return () => {
      active = false;
    };
  }, [autoConnect]);
  function resultText(text: string) {
    try {
      return {
        source: JSON.stringify(JSON.parse(text), null, 2),
        language: "json",
      };
    } catch {
      return { source: text || "（无文本返回）", language: "text" };
    }
  }
  const rendered = resultText(result?.value.content ?? "");
  const connectAction = (
    <Button
      pending={pending === "test"}
      disabled={pending !== null || !etag}
      onClick={() => void run("test")}
    >
      <Plug className="size-4" aria-hidden />
      连接
    </Button>
  );
  return (
    <div className="mcp-debug-layout">
      <h1 className="sr-only">MCP 工具调试</h1>
      <aside className="mcp-debug-tools" aria-label="MCP 工具列表">
        <div className="mcp-debug-tools-heading">
          <h2 className="mr-auto whitespace-nowrap text-base font-semibold">
            工具{" "}
            <span className="ml-1 font-normal text-muted">
              {test?.tool_count ?? "—"}
            </span>
          </h2>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              pending={pending === "test" && connected}
              disabled={pending !== null || !etag || !connected}
              onClick={() => void run("test")}
            >
              刷新
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={
                connected ? "text-danger hover:text-danger" : undefined
              }
              pending={
                pending === "disconnect" || (pending === "test" && !connected)
              }
              disabled={pending !== null || !etag}
              onClick={() => void run(connected ? "disconnect" : "test")}
            >
              {connected ? "断开" : "连接"}
            </Button>
          </div>
        </div>
        {pending && (
          <div className="px-4 py-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => controller.current?.abort()}
            >
              停止等待
            </Button>
          </div>
        )}
        <div className="mcp-debug-tool-list">
          {tools.map((item) => (
            <button
              key={item.name}
              type="button"
              aria-pressed={selected === item.name}
              disabled={pending !== null}
              onClick={() => {
                setSelected(item.name);
                setExample(undefined);
                setError(undefined);
              }}
              className="mcp-debug-tool"
            >
              <span className="block break-words text-sm font-medium">
                {item.title || item.name}
              </span>
              {item.title && (
                <span className="mt-1 block break-all font-mono text-xs text-muted">
                  {item.name}
                </span>
              )}
            </button>
          ))}
          {tools.length === 0 && (
            <p className="px-3 py-5 text-sm text-muted">
              {test?.diagnostic.status === "succeeded"
                ? "暂无工具"
                : "连接后加载工具"}
            </p>
          )}
        </div>
        <div className="mcp-debug-tools-footer">
          <details>
            <summary className="cursor-pointer text-xs text-muted">
              连接详情{diagnostic?.status === "failed" ? " · 测试失败" : ""}
            </summary>
            <div className="mt-3 space-y-2 break-words text-xs text-muted">
              <p className="break-all">{server.config.url}</p>
              <p>超时 {server.config.timeout_seconds} 秒 · 空闲 10 分钟回收</p>
              {diagnostic && (
                <>
                  <p>
                    {diagnostic.status === "succeeded"
                      ? "最近测试成功"
                      : "最近测试失败"}{" "}
                    · {diagnostic.duration_ms} ms
                  </p>
                  <p>{new Date(diagnostic.finished_at).toLocaleString()}</p>
                  {diagnostic.protocol_version && (
                    <p>协议 {diagnostic.protocol_version}</p>
                  )}
                  {diagnostic.checks
                    .filter((c) => c.reason)
                    .map((c) => (
                      <p key={c.name}>{c.reason}</p>
                    ))}
                </>
              )}
            </div>
          </details>
        </div>
      </aside>
      <section className="mcp-debug-main" aria-label="工具调试工作区">
        <div className="mcp-debug-body">
          <ErrorNotice error={error} />
          {isVersionConflict(error) && (
            <Notice
              tone="warning"
              action={
                <Button variant="outline" onClick={onRefresh}>
                  重新加载配置
                </Button>
              }
            >
              配置已变化，参数已保留，请重新加载后连接。
            </Notice>
          )}
          {outdated && (
            <Notice tone="warning">工具定义已过期，请重新连接。</Notice>
          )}
          {!connected && test?.diagnostic.status === "succeeded" && (
            <Notice action={connectAction}>
              当前未连接，连接后可继续调试。
            </Notice>
          )}
          {!test || test.diagnostic.status !== "succeeded" ? (
            <EmptyState
              title="连接服务，开始调试"
              action={!connected ? connectAction : undefined}
            />
          ) : test.tools.length === 0 ? (
            <EmptyState title="服务未提供工具" />
          ) : (
            <div className="space-y-5">
              {tool && (
                <>
                  <div className="flex items-center gap-2">
                    <h2 className="break-all text-lg font-semibold">
                      {tool.title || tool.name}
                    </h2>
                  </div>
                  {tool.description && (
                    <details key={tool.name} open className="border-t pt-4">
                      <summary className="cursor-pointer text-sm font-medium">
                        工具描述
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                        {tool.description}
                      </p>
                    </details>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">调用参数</h3>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        disabled={pending !== null}
                        onClick={() => {
                          try {
                            const value = JSON.parse(args);
                            setDrafts({
                              ...drafts,
                              [selected]: JSON.stringify(value, null, 2),
                            });
                            setError(undefined);
                          } catch (e) {
                            setError(e);
                            argsInput.current?.focus();
                          }
                        }}
                      >
                        <Braces className="size-4" />
                        格式化
                      </Button>
                      <Button
                        variant="outline"
                        pending={pending === "example"}
                        disabled={!connected || pending !== null}
                        onClick={() => void run("example")}
                      >
                        <WandSparkles className="size-4" />
                        生成示例参数
                      </Button>
                    </div>
                  </div>
                  <Field label="调用参数（JSON）" className="[&>label]:sr-only">
                    <Textarea
                      ref={argsInput}
                      rows={7}
                      spellCheck={false}
                      className="font-mono text-sm"
                      value={args}
                      disabled={pending === "call"}
                      onChange={(e) =>
                        setDrafts({ ...drafts, [selected]: e.target.value })
                      }
                    />
                  </Field>
                  {example && (
                    <div className="space-y-3 border-t pt-4">
                      <p className="text-sm font-medium">
                        示例参数 · 尚未替换当前内容
                      </p>
                      <CodeBlock
                        source={JSON.stringify(example.arguments, null, 2)}
                        language="json"
                        title="示例参数"
                        contentClassName="max-h-64"
                      />
                      {!example.valid && (
                        <Notice tone="warning">
                          草稿未通过完整校验，请手工补全。
                          {example.issues.map((issue, index) => (
                            <p key={index} className="mt-1 break-all">
                              {issue.path}：{issue.message}
                            </p>
                          ))}
                        </Notice>
                      )}
                      <p className="text-xs text-muted">
                        使用前请核对真实业务参数。
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setDrafts({
                              ...drafts,
                              [selected]: JSON.stringify(
                                example.arguments,
                                null,
                                2,
                              ),
                            });
                            setExample(undefined);
                            argsInput.current?.focus();
                          }}
                        >
                          使用示例替换参数
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setExample(undefined)}
                        >
                          取消
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Button
                      pending={pending === "call"}
                      disabled={pending !== null || !connected || unknown}
                      onClick={() => void run("call")}
                    >
                      <Play className="size-4" />
                      调用工具
                    </Button>
                    <span className="text-xs text-muted">
                      真实调用 · 可能修改远端数据 · 不自动重试
                    </span>
                  </div>
                  {unknown && (
                    <Notice tone="warning">
                      上次调用结果未知。停止等待不会撤销远端操作。
                      <label className="mt-3 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={verified}
                          onChange={(e) => setVerified(e.target.checked)}
                        />
                        已在远端核实，允许再次调用
                      </label>
                    </Notice>
                  )}
                  {!result && (
                    <div className="border-t pt-5">
                      <h3 className="text-sm font-medium">返回结果</h3>
                      <p className="py-6 text-sm text-muted">
                        调用后在这里查看结果。
                      </p>
                    </div>
                  )}
                  {result && (
                    <section
                      aria-label="工具调用结果"
                      aria-live="polite"
                      className="space-y-3 border-t pt-4"
                    >
                      <div className="flex items-center gap-3">
                        <StatusBadge
                          tone={
                            result.value.status === "succeeded"
                              ? "success"
                              : result.value.status === "outcome_unknown"
                                ? "warning"
                                : "danger"
                          }
                        >
                          {statusLabel[result.value.status]}
                        </StatusBadge>
                        <span className="break-all font-mono text-xs text-muted">
                          {result.name}
                        </span>
                        <span className="text-xs text-muted">
                          {result.value.duration_ms} ms
                        </span>
                        <StandaloneSelect
                          className="ml-auto w-36"
                          aria-label="返回结果语法高亮"
                          value={language}
                          onValueChange={setLanguage}
                        >
                          <option value="auto">自动识别</option>
                          <option value="text">纯文本</option>
                          <option value="json">JSON</option>
                          <option value="yaml">YAML</option>
                          <option value="xml">XML</option>
                          <option value="markdown">Markdown</option>
                          <option value="javascript">JavaScript</option>
                          <option value="python">Python</option>
                        </StandaloneSelect>
                      </div>
                      {result.value.executed === false && (
                        <p className="text-sm text-muted">未执行远端工具。</p>
                      )}
                      {result.value.error && (
                        <details className="text-sm text-muted">
                          <summary>错误详情</summary>
                          <code>{result.value.error}</code>
                        </details>
                      )}
                      {result.value.truncated && (
                        <Notice tone="warning">
                          返回内容已截断，或包含当前调试器不展示的媒体类型。
                        </Notice>
                      )}
                      <CodeBlock
                        source={
                          language === "auto"
                            ? rendered.source
                            : result.value.content
                        }
                        language={
                          language === "auto" ? rendered.language : language
                        }
                        title="返回结果"
                        copyLabel="复制返回结果"
                        contentLabel="返回结果内容"
                        contentClassName="max-h-[480px]"
                      />
                      {result.value.structured_content != null && (
                        <details>
                          <summary className="cursor-pointer text-sm">
                            结构化返回
                          </summary>
                          <CodeBlock
                            source={JSON.stringify(
                              result.value.structured_content,
                              null,
                              2,
                            )}
                            language="json"
                            title="结构化 JSON"
                          />
                        </details>
                      )}
                    </section>
                  )}
                  <details className="border-t pt-4">
                    <summary className="cursor-pointer text-sm font-medium">
                      查看参数及返回值定义
                    </summary>
                    <CodeBlock
                      language="json"
                      title="参数及返回值定义"
                      defaultWrap
                      contentLabel="参数及返回值定义内容"
                      contentClassName="max-h-none"
                      source={JSON.stringify(
                        {
                          input_schema: tool.input_schema,
                          output_schema: tool.output_schema,
                          annotations: tool.annotations,
                        },
                        null,
                        2,
                      )}
                    />
                  </details>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
