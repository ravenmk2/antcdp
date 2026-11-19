import { useState } from "react";
import { request, type ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Input, Select } from "@/components/fields";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Panel } from "@/components/layout";
import { ConfirmDialog } from "@/components/overlays";
import { useApiQuery } from "@/hooks/use-api";
import type {
  SandboxConnection,
  CloudConnectionWrite,
  ConnectionPreview,
} from "@/types/cloud-computer";
import { sandboxAdminRoot } from "../data/agent-api";
import { useCloudSave } from "./use-cloud-save";
import { ConfigActions } from "../resources/admin-shared";

export function ConnectionEditor() {
  const path = `${sandboxAdminRoot}/connection`;
  const query = useApiQuery<SandboxConnection>(["sandbox-connection"], path);
  return (
    <AsyncBoundary
      loading={query.isPending}
      error={query.error}
      onRetry={() => query.refetch()}
    >
      {query.data && (
        <ConnectionForm
          initial={query.data}
          path={path}
          onSaved={() => void query.refetch()}
        />
      )}
    </AsyncBoundary>
  );
}
function ConnectionForm({
  initial,
  path,
  onSaved,
}: {
  initial: ApiResponse<SandboxConnection>;
  path: string;
  onSaved: () => void;
}) {
  const from = (value: SandboxConnection): CloudConnectionWrite => ({
    endpoint: value.endpoint ?? "",
    access_mode: value.access_mode,
    connect_timeout_seconds: value.connect_timeout_seconds,
    operation_timeout_seconds: value.operation_timeout_seconds,
  });
  const [draft, setDraft] = useState(from(initial.data)),
    [baseline, setBaseline] = useState(from(initial.data));
  const [secret, setSecret] = useState(""),
    [hasSecret, setHasSecret] = useState(
      initial.data.authentication.has_secret,
    );
  const [preview, setPreview] = useState<{
      result: ConnectionPreview;
      body: CloudConnectionWrite;
    } | null>(null),
    [checking, setChecking] = useState(false),
    [error, setError] = useState<unknown>();
  const [editing, setEditing] = useState(!initial.data.requires_confirmation),
    [confirmation, setConfirmation] = useState(""),
    [probing, setProbing] = useState(false);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline) || Boolean(secret);
  const save = useCloudSave({
    initial,
    path,
    domain: sandboxAdminRoot,
    commandName: "sandbox_connection.update",
    scope: "sandbox_connection",
    dirty,
    adopt: (value) => {
      const next = from(value);
      setDraft(next);
      setBaseline(next);
      setSecret("");
      setHasSecret(value.authentication.has_secret);
      setEditing(false);
      setPreview(null);
    },
    onSaved,
  });
  const locked = save.pending || save.blocked || checking || probing;
  async function prepare() {
    const body: CloudConnectionWrite = {
      ...draft,
      endpoint: draft.endpoint.trim().replace(/\/+$/, ""),
      ...(secret
        ? {
            authentication: {
              auth_method: "api_key",
              secret: { operation: "replace", value: secret },
            },
          }
        : {}),
    };
    setError(undefined);
    // A token binds the exact proposed settings and affected logical computers.
    if (initial.data.requires_confirmation) {
      setConfirmation("");
      setChecking(true);
      try {
        const result = await request<ConnectionPreview>(`${path}/preview`, {
          method: "POST",
          body,
        });
        setPreview({ result: result.data, body });
      } catch (e) {
        setError(e);
      } finally {
        setChecking(false);
      }
    } else await save.save(body);
  }
  const clearBlocked =
    !!preview &&
    !preview.body.endpoint &&
    preview.result.affected_computers > 0;
  const diagnostic = initial.data.last_diagnostic;
  async function checkHealth() {
    setProbing(true);
    setError(undefined);
    try {
      await request(path + "/health-check", { method: "POST", body: {} });
      await onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setProbing(false);
    }
  }
  const changes = [
    ["服务地址", baseline.endpoint, draft.endpoint],
    ["数据访问方式", baseline.access_mode, draft.access_mode],
    [
      "连接超时（秒）",
      baseline.connect_timeout_seconds,
      draft.connect_timeout_seconds,
    ],
    [
      "操作超时（秒）",
      baseline.operation_timeout_seconds,
      draft.operation_timeout_seconds,
    ],
  ].filter(([, before, after]) => before !== after);
  return (
    <Panel bodyClassName="p-6">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void prepare();
        }}
      >
        <div>
          <h2 className="font-semibold">平台唯一沙箱连接</h2>
          <p className="mt-1 text-sm text-muted">
            所有个人云电脑和助手池共用此连接。
          </p>
        </div>
        {save.recovery}
        <ErrorNotice error={error} />
        <div className="space-y-2">
          <p>
            {diagnostic
              ? diagnostic.config_version !== initial.data.config_version
                ? "上次检查已过期"
                : diagnostic.healthy
                  ? "控制面连接正常"
                  : "控制面连接失败"
              : "尚未检查"}
            {diagnostic &&
              ` · ${diagnostic.elapsed_ms} ms · ${new Date(initial.data.last_diagnostic_at!).toLocaleString()} ${diagnostic.error_code || ""}`}
          </p>
          <Button
            variant="outline"
            pending={probing}
            disabled={!initial.data.endpoint || locked || editing}
            onClick={() => void checkHealth()}
          >
            手动健康检查
          </Button>
        </div>
        <fieldset disabled={locked || !editing} className="space-y-5">
          <Field
            label="服务地址"
            hint="更换地址需再次确认，已有云电脑将在新后端使用空卷重新创建。清空地址仅允许在没有运行资源时进行。"
          >
            <Input
              name="endpoint"
              type="url"
              value={draft.endpoint}
              maxLength={2048}
              placeholder="https://sandbox.example.com"
              onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })}
            />
          </Field>
          <Field
            label={hasSecret ? "替换 API Key" : "API Key"}
            hint={
              hasSecret
                ? "已配置。同一服务留空可保留，切换目标主机须重新输入。"
                : "首次使用需要配置认证。"
            }
          >
            <Input
              name="api_key"
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-5">
            <Field label="数据访问方式">
              <Select
                value={draft.access_mode}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    access_mode: v as typeof draft.access_mode,
                  })
                }
              >
                <option value="direct">直连运行实例</option>
                <option value="server_proxy">经服务端代理</option>
              </Select>
            </Field>
            <Field label="连接超时（秒）">
              <Input
                type="number"
                min={1}
                max={30}
                required
                value={draft.connect_timeout_seconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    connect_timeout_seconds: Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="操作超时（秒）">
              <Input
                type="number"
                min={10}
                max={600}
                required
                value={draft.operation_timeout_seconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    operation_timeout_seconds: Number(e.target.value),
                  })
                }
              />
            </Field>
          </div>
        </fieldset>
        {editing ? (
          <ConfigActions
            dirty={dirty}
            pending={save.pending || checking}
            blocked={save.blocked}
          >
            <Button
              type="submit"
              pending={checking || save.pending}
              disabled={!dirty || save.blocked}
            >
              {initial.data.requires_confirmation ? "预览连接变更" : "保存连接"}
            </Button>
            <Button
              variant="outline"
              disabled={locked}
              onClick={() => {
                setEditing(!initial.data.requires_confirmation);
                setDraft(baseline);
                setSecret("");
              }}
            >
              取消修改
            </Button>
          </ConfigActions>
        ) : (
          <Button
            variant="danger"
            disabled={locked}
            onClick={() => setEditing(true)}
          >
            修改连接（极度危险）
          </Button>
        )}
        {preview && (
          <ConfirmDialog
            open
            danger
            title="确认修改沙箱连接？"
            description={
              preview.result.resets_storage
                ? `影响 ${preview.result.affected_computers} 台云电脑。切换会取消排队输入和未决交互。电脑身份和会话绑定保留，下次使用会创建空卷。旧文件不迁移，旧资源须另行处理。`
                : "请核对以下变更。"
            }
            confirmLabel="确认提交"
            pending={save.pending}
            confirmDisabled={
              save.blocked ||
              clearBlocked ||
              preview.result.busy_activities > 0 ||
              confirmation !== "确认修改沙箱连接"
            }
            onClose={() => setPreview(null)}
            onConfirm={() =>
              void save.save({
                ...preview.body,
                confirmation_text: confirmation,
                confirmation_token: preview.result.confirmation_token,
              })
            }
          >
            <ul>
              {changes.map(([label, old, value]) => (
                <li key={label}>
                  {label}：{old || "空"} → {value || "清空"}
                </li>
              ))}
              {(secret || (!preview.body.endpoint && hasSecret)) && (
                <li>API Key：{preview.body.endpoint ? "已替换" : "将清除"}</li>
              )}
            </ul>
            <Field label="输入「确认修改沙箱连接」">
              <Input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </Field>
            {clearBlocked && (
              <Notice tone="warning">
                仍有 {preview.result.affected_computers}{" "}
                台云电脑，清空连接前需要先解除这些资源。
              </Notice>
            )}
            {preview.result.busy_activities > 0 && (
              <Notice tone="warning">
                仍有 {preview.result.busy_activities}{" "}
                项在途或待核实活动，请完成收尾后重新检查。
              </Notice>
            )}
            <p className="mt-3 text-sm text-muted">
              确认有效至{" "}
              {new Date(preview.result.expires_at).toLocaleTimeString()}
              ，提交时会重新核对。
            </p>
            {save.recovery}
          </ConfirmDialog>
        )}
      </form>
    </Panel>
  );
}
