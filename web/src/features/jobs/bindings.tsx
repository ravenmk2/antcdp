import { Plus, X } from "lucide-react";
import { Button, IconButton } from "@/components/button";
import { Field, Input, Select } from "@/components/fields";
import { useJobResourceDirectory } from "./resource-directory";
import type { Binding, ResourceGrant } from "./types";

export function Bindings({
  projectId,
  value,
  grants,
  onChange,
}: {
  projectId: string;
  value: Binding[];
  grants: ResourceGrant[];
  onChange: (value: Binding[]) => void;
}) {
  const directory = useJobResourceDirectory(
    projectId,
    grants,
    "",
    grants.length > 0,
  );
  function update(index: number, patch: Partial<Binding>) {
    onChange(value.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }
  return (
    <div className="space-y-4">
      {value.map((b, i) => (
        <div key={i} className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {b.name || `绑定 ${i + 1}`}
            </span>
            <IconButton
              size="iconSm"
              label="移除绑定"
              variant="ghost"
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              <X />
            </IconButton>
          </div>
          <Field label="绑定名称">
            <Input
              value={b.name}
              onChange={(e) => update(i, { name: e.target.value })}
            />
          </Field>
          <Field label="服务连接授权">
            <Select
              value={b.grant_id}
              onValueChange={(id) => {
                const grant = grants.find((g) => g.id === id);
                update(i, {
                  grant_id: id || "0",
                  connection_id: grant?.connection_id ?? "0",
                  connection_code: "",
                });
              }}
            >
              <option value="0">请选择授权</option>
              {grants
                .filter((g) => g.status === "active" || g.id === b.grant_id)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    授权 #{g.id} · {directory.connectionName(g.connection_id)} /{" "}
                    {directory.credentialName(g.connection_id, g.credential_id)}
                    {g.status === "revoked" ? "（已撤销）" : ""}
                  </option>
                ))}
            </Select>
          </Field>
          {b.connection_code && (
            <p className="break-all font-mono text-xs text-muted">
              {b.connection_code} / {b.name}
            </p>
          )}
        </div>
      ))}
      <Button
        variant="outline"
        disabled={!grants.some((g) => g.status === "active")}
        onClick={() =>
          onChange([
            ...value,
            {
              name: "",
              grant_id: "0",
              connection_id: "0",
              connection_code: "",
            },
          ])
        }
      >
        <Plus /> 添加绑定
      </Button>
      <p className="text-xs text-muted">
        先授权服务连接与项目凭证，再为脚本添加绑定。
      </p>
    </div>
  );
}
