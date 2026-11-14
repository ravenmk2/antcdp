import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { isVersionConflict, request } from "@/api/client";
import { Button } from "@/components/button";
import { useUnsaved } from "@/hooks/use-unsaved";
import { Field, Input, Select } from "@/components/fields";
import {
  AsyncBoundary,
  ErrorNotice,
  Notice,
  StatusBadge,
} from "@/components/feedback";
import {
  Modal,
  Drawer,
  OverlayCancelButton,
  ConfirmDialog,
} from "@/components/overlays";
import { Panel } from "@/components/layout";
import {
  DiagnosticView,
  modelDiagnosticReason,
} from "@/features/models/model-shared";
import type { Diagnostic } from "@/types/models";
import type { Operation } from "@/types/agents";
import type { ResourceAuthentication } from "@/types/agent-resources";
import type { AgentApiDomain } from "@/features/agents/data/agent-api";
import {
  useAgentCommand,
  useCommandResult,
} from "@/features/agents/data/agent-runtime";

export const operationNames: Record<Operation["status"], string> = {
  queued: "等待执行",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  outcome_unknown: "结果未知",
};
export function ResourceOperation({
  domain,
  id,
  title,
  onClose,
}: {
  domain: AgentApiDomain;
  id: string;
  title: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ["agent-operation", domain, id],
    queryFn: ({ signal }) =>
      request<Operation<{ diagnostic?: Diagnostic }>>(
        `${domain}/operations/${id}`,
        { signal },
      ),
    retry: false,
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.data.status ?? "")
        ? 2000
        : false,
  });
  const operation = query.data?.data;
  return (
    <Panel
      title={title}
      action={
        <Button variant="ghost" onClick={onClose}>
          收起
        </Button>
      }
    >
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {operation && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <StatusBadge
                tone={operation.status === "succeeded" ? "success" : "info"}
              >
                {operationNames[operation.status]}
              </StatusBadge>
              <span className="text-xs text-muted">操作 {id}</span>
            </div>
            {["queued", "running"].includes(operation.status) && (
              <Notice>
                操作在服务端执行，离开页面不会取消。截止时间：
                {new Date(operation.deadline_at).toLocaleString()}。
              </Notice>
            )}
            {operation.outcome.certainty === "unknown" && (
              <Notice tone="warning">
                执行结果尚未核实。此页面不会自动重新发起操作。
              </Notice>
            )}
            {operation.error_code && (
              <ErrorNotice
                error={modelDiagnosticReason(operation.error_code)}
              />
            )}
            {operation.result?.diagnostic && (
              <DiagnosticView
                modelDetails={false}
                diagnostic={operation.result.diagnostic}
              />
            )}
          </div>
        )}
      </AsyncBoundary>
    </Panel>
  );
}

export function ResourceDelete({
  domain,
  path,
  scope,
  command: commandName,
  etag,
  label,
  onDeleted,
  trigger,
}: {
  domain: AgentApiDomain;
  path: string;
  scope: string;
  command: string;
  etag: string;
  label: string;
  onDeleted: () => void;
  trigger?: (open: () => void, disabled: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const action = useAgentCommand<null>(`${domain}:${path}:delete`);
  useCommandResult(action.state, () => {
    action.command.reset();
    setOpen(false);
    onDeleted();
  });
  return (
    <div className="space-y-3">
      {action.recovery}
      {trigger ? (
        trigger(() => setOpen(true), action.pending || action.uncertain)
      ) : (
        <Button
          variant="outline"
          className="text-danger hover:text-danger"
          disabled={action.pending || action.uncertain}
          onClick={() => setOpen(true)}
        >
          删除{label}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title={`删除${label}？`}
        description="删除前会检查当前引用和运行状态；仍被占用时会拒绝删除。此操作不会撤销已经执行的任务。"
        danger
        confirmLabel="确认删除"
        pending={action.pending || action.uncertain}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          void action.command
            .run({
              domain,
              path,
              command: commandName,
              scope,
              options: { method: "DELETE", etag },
            })
            .then(() => {
              if (action.command.getSnapshot().phase === "failed")
                setOpen(false);
            });
        }}
      >
        {action.recovery}
      </ConfirmDialog>
    </div>
  );
}

export function ResourceAuthenticationEditor({
  domain,
  path,
  scope,
  command: commandName,
  etag,
  authentication,
  mcp = false,
  drawer = false,
  onSaved,
  onClose,
}: {
  domain: AgentApiDomain;
  path: string;
  scope: string;
  command: string;
  etag: string;
  authentication: ResourceAuthentication & { header_name?: string | null };
  mcp?: boolean;
  drawer?: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const action = useAgentCommand<unknown>(`${domain}:${path}:authentication`);
  const [method, setMethod] = useState(authentication.auth_method),
    [operation, setOperation] = useState<"keep" | "replace" | "clear">("keep"),
    [secret, setSecret] = useState(""),
    [header, setHeader] = useState(authentication.header_name ?? "X-API-Key"),
    [version, setVersion] = useState(etag),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState<unknown>();
  const dirty =
    method !== authentication.auth_method ||
    operation !== "keep" ||
    Boolean(secret) ||
    (method === "custom_header" &&
      mcp &&
      header !== (authentication.header_name ?? "X-API-Key"));
  const release = useUnsaved(
    dirty,
    action.pending || action.uncertain || refreshing,
  );
  useCommandResult(action.state, () => {
    release();
    setSecret("");
    action.command.reset();
    onSaved();
    onClose();
  });
  const conflict =
    action.state.phase === "failed" && isVersionConflict(action.state.error);
  const Container = drawer ? Drawer : Modal;
  return (
    <Container
      open
      title="管理认证"
      description="已保存的认证凭据不会回显。替换和清除使用独立的认证操作。"
      pending={action.pending || action.uncertain || refreshing}
      dirty={dirty}
      onClose={() => {
        release();
        onClose();
      }}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            type="submit"
            form="resource-auth"
            pending={action.pending}
            disabled={action.uncertain || refreshing || conflict}
          >
            保存认证
          </Button>
        </>
      }
    >
      <form
        id="resource-auth"
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          void action.command.run({
            domain,
            path: `${path}/authentication`,
            command: commandName,
            scope,
            options: {
              method: "PUT",
              etag: version,
              body: {
                auth_method: method,
                ...(mcp
                  ? { header_name: method === "custom_header" ? header : null }
                  : {}),
                secret:
                  method === "none"
                    ? { operation: "clear" }
                    : {
                        operation,
                        ...(operation === "replace" ? { value: secret } : {}),
                      },
              },
            },
          });
        }}
      >
        {action.recovery}
        <ErrorNotice error={error} />
        {conflict && (
          <Notice tone="warning">
            认证配置已变化，当前输入仍保留。
            <Button
              className="mt-3"
              variant="outline"
              pending={refreshing}
              onClick={() => {
                setRefreshing(true);
                void request(`${domain}${path}`)
                  .then((value) => {
                    setVersion(value.etag);
                    action.command.reset();
                  })
                  .catch(setError)
                  .finally(() => setRefreshing(false));
              }}
            >
              读取最新版本后重新核对
            </Button>
          </Notice>
        )}
        <fieldset
          disabled={action.pending || action.uncertain || refreshing}
          className="space-y-5"
        >
          <Field label="认证方式">
            <Select
              value={method}
              onValueChange={(value) => {
                setMethod(value);
                if (value !== authentication.auth_method)
                  setOperation(value === "none" ? "clear" : "replace");
              }}
            >
              <option value={mcp ? "custom_header" : "api_key"}>
                {mcp ? "自定义" : "API Key"}
              </option>
              {mcp && <option value="bearer">Bearer Token</option>}
              {mcp && <option value="none">无需认证</option>}
            </Select>
          </Field>
          {method === "custom_header" && mcp && (
            <Field label="认证请求头">
              <Input
                required
                maxLength={64}
                value={header}
                onChange={(event) => {
                  setHeader(event.target.value);
                  setOperation("replace");
                }}
              />
            </Field>
          )}
          {method !== "none" && (
            <>
              <Field
                label="认证凭据处理"
                hint={
                  authentication.has_secret
                    ? "当前已保存认证凭据。"
                    : "当前没有可用认证凭据。"
                }
              >
                <Select
                  value={operation}
                  onValueChange={(value) =>
                    setOperation(value as typeof operation)
                  }
                >
                  <option value="keep">保留现有认证凭据</option>
                  <option value="replace">替换认证凭据</option>
                  <option value="clear">清除认证凭据</option>
                </Select>
              </Field>
              {operation === "replace" && (
                <Field label="新认证凭据">
                  <Input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(event) => setSecret(event.target.value)}
                  />
                </Field>
              )}
            </>
          )}
        </fieldset>
      </form>
    </Container>
  );
}
