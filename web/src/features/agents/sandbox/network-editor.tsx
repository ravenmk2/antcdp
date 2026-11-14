import { Field, Select, Textarea } from "@/components/fields";
import { ArrowDown, ShieldCheck, ShieldMinus, ShieldPlus } from "lucide-react";
import { AsyncBoundary, Notice } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";
import type { SandboxNetworkPolicy } from "@/types/agents";
import type { NetworkPresetCatalog } from "@/types/agent-sandbox";
import { agentAdminRoot } from "../data/agent-api";

export function initialNetworkPolicy(): SandboxNetworkPolicy {
  return {
    default_action: "allow",
    preset_ids: [
      "private_ipv4_v1",
      "private_ipv6_v1",
      "link_local_v1",
      "shared_ipv4_v1",
    ],
    allow_targets: [],
    deny_targets: [],
  };
}
export function NetworkPolicyEditor({
  value,
  onChange,
  disabled = false,
  prefix = "network",
}: {
  value: SandboxNetworkPolicy;
  onChange: (policy: SandboxNetworkPolicy) => void;
  disabled?: boolean;
  prefix?: string;
}) {
  const catalog = useApiQuery<NetworkPresetCatalog>(
    ["sandbox", "network-presets"],
    `${agentAdminRoot}/sandbox-network-presets`,
  );
  return (
    <fieldset disabled={disabled} className="sandbox-network-editor">
      <div className="sandbox-network-default">
        <div>
          <h3>默认行为</h3>
          <p>目标未匹配任何规则时，按此动作处理。</p>
        </div>
        <Field label="未匹配目标的默认动作">
          <Select
            value={value.default_action}
            onValueChange={(action) =>
              onChange({ ...value, default_action: action as "allow" | "deny" })
            }
          >
            <option value="allow">允许</option>
            <option value="deny">阻止</option>
          </Select>
        </Field>
      </div>
      <section className="sandbox-network-section">
        <div className="sandbox-section-heading">
          <ShieldCheck aria-hidden />
          <div>
            <h3>基础阻止范围</h3>
            <p>勾选需要阻止的地址范围，可通过明确允许的地址设置例外。</p>
          </div>
        </div>
        <AsyncBoundary
          loading={catalog.isPending}
          error={catalog.error}
          onRetry={() => catalog.refetch()}
        >
          <div className="sandbox-network-presets">
            {catalog.data?.data.items.map((preset) => (
              <div
                key={preset.id}
                className="sandbox-network-preset"
                data-checked={value.preset_ids.includes(preset.id)}
              >
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={value.preset_ids.includes(preset.id)}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        preset_ids: event.target.checked
                          ? [...value.preset_ids, preset.id]
                          : value.preset_ids.filter((id) => id !== preset.id),
                      })
                    }
                  />
                  <span className="min-w-0 break-words">{preset.name}</span>
                </label>
                <details className="ml-7 mt-2 text-xs text-muted">
                  <summary className="cursor-pointer">查看具体范围</summary>
                  <p className="mt-2 leading-5">{preset.description}</p>
                  <ul className="mt-2 space-y-1 break-all font-mono">
                    {preset.targets.map((target) => (
                      <li key={target}>{target}</li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
        </AsyncBoundary>
      </section>
      <section className="sandbox-network-section">
        <div className="sandbox-section-heading">
          <ShieldPlus aria-hidden />
          <div>
            <h3>自定义目标</h3>
            <p>
              每行一个 IP、CIDR、ASCII 域名或 *.example.com，允许和阻止各最多
              100 项。
            </p>
          </div>
        </div>
        <div className="sandbox-network-targets">
          {(
            [
              ["allow_targets", "明确允许"],
              ["deny_targets", "明确阻止"],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              hint={
                key === "allow_targets"
                  ? "IP 允许可覆盖基础阻止范围；域名允许不自动放开其内网地址。"
                  : "相同目标同时出现时，明确阻止优先。"
              }
              className={`sandbox-network-target sandbox-network-target-${key === "allow_targets" ? "allow" : "deny"}`}
            >
              {key === "allow_targets" ? (
                <ShieldPlus className="sandbox-target-icon" aria-hidden />
              ) : (
                <ShieldMinus className="sandbox-target-icon" aria-hidden />
              )}
              <Textarea
                name={`${prefix}.${key}`}
                rows={6}
                spellCheck={false}
                className="font-mono"
                value={value[key].join("\n")}
                onChange={(event) =>
                  onChange({ ...value, [key]: event.target.value.split("\n") })
                }
              />
            </Field>
          ))}
        </div>
        <p className="sandbox-network-hint">
          不接受 URL、端口或路径；*.example.com 不包含裸域 example.com。
        </p>
      </section>
      <Notice className="sandbox-policy-notice">
        <strong className="block mb-2">仅在新建或重建实例时生效</strong>
        <span className="sandbox-rule-order">
          部署强制保护 <ArrowDown aria-hidden /> 明确阻止{" "}
          <ArrowDown aria-hidden /> 明确允许 <ArrowDown aria-hidden />{" "}
          基础阻止范围 <ArrowDown aria-hidden /> 默认动作
        </span>
        <span className="block mt-2">
          部署保护不可覆盖。域名与地址层均需通过，默认阻止时按域名访问还需明确允许域名。
        </span>
      </Notice>
    </fieldset>
  );
}
export function normalizeNetworkDraft(
  policy: SandboxNetworkPolicy,
): SandboxNetworkPolicy {
  return {
    ...policy,
    allow_targets: policy.allow_targets
      .map((value) => value.trim())
      .filter(Boolean),
    deny_targets: policy.deny_targets
      .map((value) => value.trim())
      .filter(Boolean),
  };
}
