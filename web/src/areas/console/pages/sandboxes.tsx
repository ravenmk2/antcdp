import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/button";
import { Field, Input } from "@/components/fields";
import { PageHeader, Panel } from "@/components/layout";
import { AsyncBoundary } from "@/components/feedback";
import { ConfirmDialog } from "@/components/overlays";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useUnsaved } from "@/hooks/use-unsaved";
import { ConnectionEditor } from "@/features/agents/cloud/connection-editor";
import { sandboxAdminRoot } from "@/features/agents/data/agent-api";
import {
  useAgentCommand,
  useCommandResult,
} from "@/features/agents/data/agent-runtime";
import {
  NetworkPolicyEditor,
  initialNetworkPolicy,
  normalizeNetworkDraft,
} from "@/features/agents/sandbox/network-editor";
import type { SandboxSpec, SpecReference } from "@/types/cloud-computer";

export function SandboxesPage() {
  const [params, setParams] = useSearchParams();
  const specs = params.get("tab") === "specs";
  return (
    <div className="page space-y-5">
      <PageHeader title="沙箱配置" description="管理平台沙箱连接与运行规格。" />
      <div className="flex gap-2">
        <Button
          variant={specs ? "outline" : "default"}
          onClick={() => setParams({})}
        >
          服务连接
        </Button>
        <Button
          variant={specs ? "default" : "outline"}
          onClick={() => setParams({ tab: "specs" })}
        >
          沙箱规格
        </Button>
      </div>
      {specs ? <SpecCatalog /> : <ConnectionEditor />}
    </div>
  );
}
function SpecCatalog() {
  const q = useApiQuery<SandboxSpec[]>(
    ["sandbox-specs"],
    sandboxAdminRoot + "/specs",
  );
  const client = useQueryClient();
  const [editing, setEditing] = useState<SandboxSpec | "new" | null>(null);
  function finish() {
    setEditing(null);
    void client.invalidateQueries({ queryKey: ["sandbox-specs"] });
    void client.invalidateQueries({ queryKey: ["cloud-spec-binding"] });
  }
  if (editing)
    return (
      <SpecForm
        key={editing === "new" ? "new" : editing.id}
        initial={editing === "new" ? null : editing}
        close={finish}
      />
    );
  return (
    <Panel title="沙箱规格" bodyClassName="space-y-4 p-6">
      <Button onClick={() => setEditing("new")}>创建规格</Button>
      <AsyncBoundary
        loading={q.isPending}
        error={q.error}
        empty={q.data?.data.length === 0}
        emptyTitle="暂无沙箱规格"
        onRetry={() => q.refetch()}
      >
        <SimpleTable
          label="沙箱规格"
          headers={[
            "名称",
            "容器镜像",
            "CPU（毫核）",
            "内存（MiB）",
            "版本",
            "操作",
          ]}
        >
          {q.data?.data.map((v) => (
            <tr key={v.id}>
              <td>{v.name}</td>
              <td>{v.image}</td>
              <td>{v.cpu_millicores}</td>
              <td>{v.memory_mib}</td>
              <td>{v.config_version}</td>
              <td>
                <Button variant="outline" onClick={() => setEditing(v)}>
                  管理
                </Button>
              </td>
            </tr>
          ))}
        </SimpleTable>
      </AsyncBoundary>
    </Panel>
  );
}
function SpecForm({
  initial,
  close,
}: {
  initial: SandboxSpec | null;
  close: () => void;
}) {
  const empty = {
    name: "",
    image: "",
    cpu_millicores: 2000,
    memory_mib: 4096,
    network: initialNetworkPolicy(),
  };
  const baseline = initial ?? empty;
  const [draft, setDraft] = useState(baseline);
  const [deleting, setDeleting] = useState(false);
  const path = "/specs" + (initial ? "/" + initial.id : "");
  const scope = "sandbox_spec" + (initial ? ":" + initial.id : "");
  const action = useAgentCommand<SandboxSpec>("sandbox-spec:" + scope);
  const refs = useApiQuery<SpecReference[]>(
    ["sandbox-spec-references", initial?.id],
    sandboxAdminRoot + path + "/references",
    { enabled: !!initial },
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  const locked = action.pending || action.uncertain;
  const release = useUnsaved(dirty, locked);
  useCommandResult(action.state, () => {
    release();
    action.command.reset();
    close();
  });
  function submit(remove: boolean) {
    const method = remove ? "DELETE" : initial ? "PUT" : "POST";
    const body = remove
      ? undefined
      : {
          name: draft.name,
          image: draft.image,
          cpu_millicores: draft.cpu_millicores,
          memory_mib: draft.memory_mib,
          network: normalizeNetworkDraft(draft.network),
        };
    void action.command.run({
      domain: sandboxAdminRoot,
      path,
      scope,
      command:
        "sandbox_spec." + (remove ? "delete" : initial ? "update" : "create"),
      options: {
        method,
        body,
        etag: initial ? `"${initial.version}"` : undefined,
      },
    });
  }
  return (
    <Panel title={initial ? initial.name : "创建沙箱规格"} bodyClassName="p-6">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        {action.recovery}
        {initial && (
          <AsyncBoundary
            loading={refs.isPending}
            error={refs.error}
            onRetry={() => refs.refetch()}
          >
            <p>
              当前引用：{refs.data?.data.map((r) => r.name).join("、") || "无"}
              。修改在下次创建或重建时生效。
            </p>
          </AsyncBoundary>
        )}
        <fieldset className="space-y-5" disabled={locked}>
          <Field label="规格名称" required>
            <Input
              required
              maxLength={128}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field
            label="容器镜像"
            hint="使用明确版本标签或 sha256 摘要。镜像须包含平台要求的运行环境。"
            required
          >
            <Input
              name="image"
              required
              maxLength={512}
              placeholder="registry.example.com/agent-runtime:1.0.0"
              value={draft.image}
              onChange={(e) => setDraft({ ...draft, image: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-6">
            <Field label="CPU（毫核）">
              <Input
                required
                type="number"
                min={100}
                max={32000}
                value={draft.cpu_millicores}
                onChange={(e) =>
                  setDraft({ ...draft, cpu_millicores: Number(e.target.value) })
                }
              />
            </Field>
            <Field label="内存（MiB）">
              <Input
                required
                type="number"
                min={128}
                max={65536}
                value={draft.memory_mib}
                onChange={(e) =>
                  setDraft({ ...draft, memory_mib: Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <NetworkPolicyEditor
            value={draft.network}
            onChange={(network) => setDraft({ ...draft, network })}
          />
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            pending={action.pending}
            disabled={!dirty || locked || (!!initial && !refs.isSuccess)}
          >
            保存规格
          </Button>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => {
              release();
              action.command.reset();
              close();
            }}
          >
            取消
          </Button>
          {initial && (
            <Button
              variant="danger"
              disabled={locked || !refs.isSuccess || !!refs.data?.data.length}
              onClick={() => setDeleting(true)}
            >
              删除规格
            </Button>
          )}
        </div>
      </form>
      {deleting && (
        <ConfirmDialog
          open
          danger
          title="删除沙箱规格？"
          description={initial?.name}
          pending={locked}
          onClose={() => setDeleting(false)}
          onConfirm={() => submit(true)}
          confirmLabel="删除规格"
        >
          {action.recovery}
        </ConfirmDialog>
      )}
    </Panel>
  );
}
