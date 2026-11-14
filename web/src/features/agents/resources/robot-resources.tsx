import { useState } from "react";
import { isVersionConflict, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { StandaloneSelect, StandaloneInput } from "@/components/fields";
import { Panel } from "@/components/layout";
import { Pagination } from "@/components/pagination";
import { SimpleTable } from "@/components/table";
import { useApiQuery } from "@/hooks/use-api";
import { useDebouncedSearch } from "@/hooks/use-search";
import { providerFor } from "@/domain/service-providers";
import { sshProvider } from "@/domain/ssh-provider";
import { CredentialPanel } from "@/features/credentials/credential-panel";
import type { AgentDefinition } from "@/types/agents";
import type { Resource, Page, ResourceKind } from "@/types/collaboration";
import type { ServiceConnection } from "@/types/integrations";

export function RobotResources({
  agent,
  readOnly = false,
}: {
  agent: AgentDefinition;
  readOnly?: boolean;
}) {
  const [section, setSection] = useState<"projects" | "teams" | "credentials">(
    "projects",
  );
  return (
    <div className="space-y-5">
      <Notice>
        专属机器人账号：{agent.robot_user_id}
        。资料和启停状态随智能体同步，无法换绑或独立编辑。权限修改对下一轮生效，已经开始的轮次继续完成。
      </Notice>
      <div className="flex gap-2">
        {(
          [
            ["projects", "项目权限"],
            ["teams", "团队权限"],
            ["credentials", "账号凭据"],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={section === key ? "default" : "outline"}
            onClick={() => setSection(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {section === "credentials" ? (
        <RobotCredentials agentId={agent.id} readOnly={readOnly} />
      ) : (
        <RobotMembership
          key={section}
          agentId={agent.id}
          kind={section}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
function RobotMembership({
  agentId,
  kind,
  readOnly,
}: {
  agentId: string;
  kind: ResourceKind;
  readOnly: boolean;
}) {
  const [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [size, setSize] = useState(20);
  const search = useDebouncedSearch(q, (value) => {
    setQ(value);
    setPage(1);
  });
  const base = `/admin/agents/${agentId}/grants/${kind}`;
  const query = useApiQuery<Page<Resource>>(
    ["robot-grants", agentId, kind, q, page, size],
    `${base}?${new URLSearchParams({ q, page: String(page), page_size: String(size) })}`,
  );
  return (
    <Panel bodyClassName="p-5 space-y-4">
      <StandaloneInput
        className="max-w-sm"
        aria-label="搜索授权资源"
        placeholder="搜索名称"
        value={search.value}
        onChange={(e) => search.setValue(e.target.value)}
      />
      <p className="text-sm text-muted">
        直接权限与真人成员使用同一规则。项目权限还可从关联团队继承，移除直接授权不一定撤销继承权限。
      </p>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
        empty={query.data?.data.items.length === 0}
        emptyTitle="暂无匹配资源"
      >
        <SimpleTable
          label="机器人资源权限"
          headers={
            readOnly
              ? ["资源", "当前访问", "直接权限"]
              : ["资源", "当前访问", "直接权限", "操作"]
          }
          actions={!readOnly}
        >
          {query.data?.data.items.map((item) => (
            <GrantRow
              key={`${item.id}:${item.membership_version}`}
              item={item}
              base={base}
              readOnly={readOnly}
              onSaved={() => void query.refetch()}
            />
          ))}
        </SimpleTable>
        <Pagination
          page={page}
          size={size}
          total={query.data?.data.total}
          pending={query.isFetching}
          onChange={(next, count) => {
            setPage(next);
            setSize(count);
          }}
        />
      </AsyncBoundary>
    </Panel>
  );
}
function GrantRow({
  item,
  base,
  onSaved,
  readOnly,
}: {
  item: Resource;
  base: string;
  onSaved: () => void;
  readOnly: boolean;
}) {
  const [role, setRole] = useState(item.direct_role),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
  const conflict = isVersionConflict(error);
  return (
    <tr>
      <td>
        <span className="font-medium">{item.name}</span>
        <p className="text-xs text-muted">{item.code}</p>
      </td>
      <td>{item.is_member ? "可以访问" : "未授权"}</td>
      <td>
        {readOnly ? (
          item.direct_role === "admin" ? (
            "管理员"
          ) : item.direct_role === "member" ? (
            "成员"
          ) : (
            "无直接权限"
          )
        ) : (
          <StandaloneSelect
            aria-label={`${item.name} 的直接权限`}
            value={role || "none"}
            disabled={pending || conflict}
            onValueChange={(value) =>
              setRole(value === "none" ? "" : (value as typeof role))
            }
          >
            <option value="none">无直接权限</option>
            <option value="member">成员</option>
            <option value="admin">管理员</option>
          </StandaloneSelect>
        )}
        <ErrorNotice error={error} />
      </td>
      {!readOnly && (
        <td>
          <Button
            variant="outline"
            pending={pending}
            disabled={role === item.direct_role || conflict}
            onClick={async () => {
              setPending(true);
              setError(undefined);
              try {
                await request(`${base}/${item.id}`, {
                  method: "PUT",
                  etag: item.membership_etag,
                  body: { role },
                });
                onSaved();
              } catch (e) {
                setError(e);
              } finally {
                setPending(false);
              }
            }}
          >
            保存
          </Button>
          {conflict && (
            <Button variant="ghost" onClick={onSaved}>
              读取最新权限
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}
function RobotCredentials({
  agentId,
  readOnly,
}: {
  agentId: string;
  readOnly: boolean;
}) {
  const [kind, setKind] = useState<"services" | "hosts">("services"),
    [selected, setSelected] = useState<string>("");
  const path = kind === "services" ? "/service-connections" : "/remote-hosts";
  const query = useApiQuery<{ items: ServiceConnection[] }>(
    ["robot-credential-directory", kind],
    path,
  );
  const item = query.data?.data.items.find((v) => v.id === selected);
  const provider = item
    ? kind === "hosts"
      ? sshProvider
      : providerFor(item.service_type)
    : undefined;
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <StandaloneSelect
          aria-label="凭据类别"
          value={kind}
          onValueChange={(value) => {
            setKind(value as typeof kind);
            setSelected("");
          }}
        >
          <option value="services">服务集成</option>
          <option value="hosts">远程主机</option>
        </StandaloneSelect>
        <StandaloneSelect
          aria-label="选择连接"
          value={selected}
          onValueChange={setSelected}
        >
          <option value="">选择要配置凭据的连接</option>
          {query.data?.data.items.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.enabled ? "" : "（已停用）"}
            </option>
          ))}
        </StandaloneSelect>
      </div>
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => query.refetch()}
      >
        {item && provider ? (
          <CredentialPanel
            readonly={readOnly}
            key={`${kind}:${selected}`}
            provider={provider}
            base={`/admin/agents/${agentId}/${kind === "hosts" ? "remote-hosts" : `service-connections/${item.service_type}`}/${item.id}/credentials`}
          />
        ) : (
          <Notice>选择连接后管理机器人的账号凭据。秘密保存后不可读取。</Notice>
        )}
      </AsyncBoundary>
    </div>
  );
}
