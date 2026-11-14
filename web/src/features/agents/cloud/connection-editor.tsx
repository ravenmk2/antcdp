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
import { agentAdminRoot } from "../data/agent-api";
import { useCloudSave } from "./use-cloud-save";
import { ConfigActions } from "../resources/admin-shared";

export function ConnectionEditor() {
  const path = `${agentAdminRoot}/sandbox-connection`;
  const query = useApiQuery<SandboxConnection>(["cloud-connection"], path);
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
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline) || Boolean(secret);
  const save = useCloudSave({
    initial,
    path,
    commandName: "sandbox_connection.update",
    scope: "sandbox_connection",
    dirty,
    adopt: (value) => {
      const next = from(value);
      setDraft(next);
      setBaseline(next);
      setSecret("");
      setHasSecret(value.authentication.has_secret);
      setPreview(null);
    },
    onSaved,
  });
  const locked = save.pending || save.blocked || checking;
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
    if (baseline.endpoint && baseline.endpoint !== body.endpoint) {
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
            所有个人云电脑和机器人云电脑共用。镜像、CPU、内存与网络规则在各自的创建配置中维护。
          </p>
        </div>
        {save.recovery}
        <ErrorNotice error={error} />
        <fieldset disabled={locked} className="space-y-5">
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
                ? "已配置。留空保留当前秘密，保存后无法读回。"
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
            {baseline.endpoint && baseline.endpoint !== draft.endpoint
              ? "检查更换影响"
              : "保存连接"}
          </Button>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              setDraft(baseline);
              setSecret("");
            }}
          >
            取消修改
          </Button>
        </ConfigActions>
        {preview && (
          <ConfirmDialog
            open
            danger
            title="确认更换沙箱服务地址？"
            description={`影响 ${preview.result.affected_computers} 台云电脑。逻辑电脑与会话绑定保留，下次使用创建新的空数据卷。原文件不迁移，旧后端资源由管理员自行处理。平台历史、附件和正式成果保留。`}
            confirmLabel="承担后果并更换地址"
            pending={
              save.pending || save.blocked || preview.result.busy_activities > 0
            }
            onClose={() => setPreview(null)}
            onConfirm={() =>
              void save.save({
                ...preview.body,
                confirmation_token: preview.result.confirmation_token,
              })
            }
          >
            <p className="break-all text-sm">
              目标地址：{preview.body.endpoint || "清空连接"}
            </p>
            {preview.result.busy_activities > 0 && (
              <Notice tone="warning">
                仍有 {preview.result.busy_activities}{" "}
                项在途或待核实活动，请完成收尾后重新检查。
              </Notice>
            )}
            <p className="mt-3 text-sm text-muted">
              切换会取消排队输入和未决交互。确认有效至{" "}
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
