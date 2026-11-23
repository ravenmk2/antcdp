import { useState } from "react";
import { useParams } from "react-router";
import { KeyRound, Plus } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { PageHeader } from "@/components/layout";
import { AsyncBoundary, ErrorNotice, StatusBadge } from "@/components/feedback";
import {
  Field,
  Input,
  Select,
  StandaloneInput,
  StandaloneSelect,
  Textarea,
} from "@/components/fields";
import { SimpleTable } from "@/components/table";
import { ConfirmDialog, Drawer } from "@/components/overlays";
import { DateTimePicker } from "@/components/date-time-picker";
import type { Resource } from "@/types/collaboration";
import { useAuth } from "@/app/auth";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/utils";
import type {
  Credential,
  CredentialKind,
  CredentialSet,
} from "@/types/integrations";
const labels: Record<CredentialKind, string> = {
  username_password: "用户名和密码",
  secret: "Secret",
  ssh_private_key: "SSH 用户和私钥",
  access_key_pair: "AccessKey 密钥对",
};
type Mode = "create" | "edit" | "rotate";
export function CredentialCatalog({
  personal = false,
}: {
  personal?: boolean;
}) {
  const { projectId, robotId } = useParams();
  const scope = projectId
    ? "项目"
    : robotId
      ? "机器人账号"
      : personal
        ? "个人"
        : "平台";
  const base =
    (projectId
      ? `/projects/${projectId}`
      : robotId
        ? `/admin/robots/${robotId}`
        : personal
          ? "/me"
          : "/admin") + "/credentials";
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId}`,
    { enabled: !!projectId },
  );
  return (
    <Catalog
      key={base}
      base={base}
      scope={scope}
      readonly={
        !!projectId &&
        (!project.data?.data.can_manage ||
          project.data.data.status === "archived")
      }
    />
  );
}
function Catalog({
  base,
  scope,
  readonly,
}: {
  base: string;
  scope: string;
  readonly: boolean;
}) {
  const query = useApiQuery<CredentialSet>(["credential-catalog", base], base);
  const cache = useQueryClient();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [editor, setEditor] = useState<{
    mode: Mode;
    entry?: Credential;
  } | null>(null);
  const [deleting, setDeleting] = useState<Credential | null>(null);
  const mutation = useSubmission();
  const { settings } = useAuth();
  const items = (query.data?.data.items ?? []).filter(
    (c) =>
      (!kind || kind === c.kind) &&
      [c.code, c.name, c.identifier].some((s) =>
        s.toLowerCase().includes(search.trim().toLowerCase()),
      ),
  );
  const refresh = async () => {
    await Promise.all([
      query.refetch(),
      ...["credentials", "job-credentials", "preferred-diagnostic"].map((key) =>
        cache.invalidateQueries({ queryKey: [key] }),
      ),
    ]);
  };
  return (
    <div className="page grid content-start gap-5">
      <PageHeader
        title={scope + "凭据"}
        description="集中维护登录身份和认证材料，在服务连接或远程主机中选择使用。"
        actions={
          <Button
            disabled={readonly || !query.data}
            onClick={() => setEditor({ mode: "create" })}
          >
            <Plus />
            新建凭据
          </Button>
        }
      />
      <section className="panel">
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-5 py-4">
          <StandaloneInput
            aria-label="搜索凭据"
            className="max-w-sm"
            placeholder="搜索名称、编码或身份"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="w-52 max-w-full">
            <StandaloneSelect
              aria-label="凭据类型筛选"
              value={kind}
              onValueChange={setKind}
            >
              <option value="">全部类型</option>
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </StandaloneSelect>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            刷新
          </Button>
          <span className="ml-auto text-sm text-muted">
            {items.length} 条凭据
          </span>
        </div>
        <AsyncBoundary
          loading={query.isPending}
          error={query.error}
          onRetry={() => query.refetch()}
          empty={!items.length}
          emptyTitle={search || kind ? "没有匹配的凭据" : "尚未创建凭据"}
          emptyDescription={
            search || kind
              ? "调整搜索条件后重试。"
              : "创建凭据后，即可在同一范围的资源中选择。"
          }
        >
          <SimpleTable
            label="凭据目录"
            headers={[
              "名称 / 编码",
              "类型",
              "身份",
              "状态",
              "到期时间",
              "操作",
            ]}
          >
            {items.map((c) => {
              const expired =
                c.expires_at && Date.parse(c.expires_at) <= Date.now();
              return (
                <tr key={c.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <KeyRound aria-hidden className="size-4 text-muted" />
                      <div>
                        <strong>{c.name}</strong>
                        <div className="font-mono text-xs text-muted">
                          {c.code}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{labels[c.kind]}</td>
                  <td>{c.identifier || "—"}</td>
                  <td>
                    <StatusBadge
                      tone={
                        !c.enabled ? "neutral" : expired ? "warning" : "success"
                      }
                    >
                      {!c.enabled ? "已停用" : expired ? "已到期" : "可用"}
                    </StatusBadge>
                  </td>
                  <td>
                    {c.expires_at
                      ? formatDate(c.expires_at, settings.timezone)
                      : "长期有效"}
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {(["edit", "rotate"] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant="ghost"
                          disabled={readonly}
                          onClick={() => setEditor({ mode, entry: c })}
                        >
                          {mode === "edit" ? "编辑" : "轮换"}
                        </Button>
                      ))}
                      <Button
                        disabled={readonly}
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          mutation.setError(null);
                          setDeleting(c);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </SimpleTable>
        </AsyncBoundary>
      </section>
      {editor && (
        <CredentialEditor
          {...editor}
          base={base}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            await refresh();
            setEditor(null);
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="删除凭据"
        description={deleting?.name}
        danger
        confirmLabel="删除"
        pending={mutation.pending}
        confirmDisabled={mutation.uncertain}
        onClose={() => setDeleting(null)}
        onConfirm={() =>
          void mutation.run(async () => {
            if (!deleting) return;
            await request(base + "/" + deleting.id, {
              method: "DELETE",
              etag: '"' + deleting.version + '"',
            });
            await refresh();
            setDeleting(null);
          })
        }
      >
        <ErrorNotice error={mutation.error} />
      </ConfirmDialog>
    </div>
  );
}
function CredentialEditor({
  base,
  mode,
  entry,
  onClose,
  onSaved,
}: {
  base: string;
  mode: Mode;
  entry?: Credential;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [kind, setKind] = useState<CredentialKind>(
    entry?.kind ?? "username_password",
  );
  const [name, setName] = useState(entry?.name ?? "");
  const [code, setCode] = useState(entry?.code ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [identifier, setIdentifier] = useState(entry?.identifier ?? "");
  const [value, setValue] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [enabled, setEnabled] = useState(entry?.enabled ?? true);
  const [expiry, setExpiry] = useState(entry?.expires_at ?? "");
  const [dirty, setDirty] = useState(false);
  const { settings } = useAuth();
  const mutation = useSubmission();
  const secretLabel =
    kind === "ssh_private_key"
      ? "SSH 私钥"
      : kind === "username_password"
        ? "密码"
        : kind === "access_key_pair"
          ? "AccessKey Secret"
          : "Secret";
  const title =
    mode === "create"
      ? "新建凭据"
      : mode === "rotate"
        ? "轮换认证材料"
        : "编辑凭据";
  return (
    <Drawer
      open
      title={title}
      description={entry ? entry.name + " · " + entry.code : undefined}
      dirty={dirty}
      pending={mutation.pending}
      onClose={onClose}
      footer={
        <Button
          type="submit"
          form="credential-form"
          pending={mutation.pending}
          disabled={mutation.uncertain}
        >
          {" "}
          {mode === "rotate" ? "保存新材料" : "保存凭据"}
        </Button>
      }
    >
      <form
        id="credential-form"
        className="grid gap-5"
        onChange={() => setDirty(true)}
        onSubmit={(e) => {
          e.preventDefault();
          if (mutation.pending || mutation.uncertain) return;
          void mutation.run(async () => {
            const metadata = {
              name: name.trim(),
              description,
              enabled,
              expires_at: expiry || null,
            };
            const auth = {
              identifier: kind === "secret" ? "" : identifier,
              material: {
                value,
                ...(kind === "ssh_private_key" ? { passphrase } : {}),
              },
            };
            await request(entry ? base + "/" + entry.id : base, {
              method: entry ? "PATCH" : "POST",
              etag: entry ? '"' + entry.version + '"' : undefined,
              body:
                mode === "create"
                  ? { ...metadata, ...auth, code, kind }
                  : mode === "rotate"
                    ? auth
                    : metadata,
            });
            await onSaved();
          });
        }}
      >
        <ErrorNotice error={mutation.error} />
        {mode !== "rotate" && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <Field label="名称" required>
                <Input
                  value={name}
                  required
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label="编码" hint="留空自动生成">
                <Input
                  readOnly={!!entry}
                  value={code}
                  pattern={"[a-z0-9][a-z0-9_\\x2d]{0,63}"}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
            </div>
            <Field label="说明">
              <Textarea
                value={description}
                maxLength={1000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="有效期">
              <DateTimePicker
                name="expires_at"
                timezone={settings.timezone}
                value={expiry}
                onChange={(v) => {
                  setExpiry(v);
                  setDirty(true);
                }}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              启用凭据
            </label>
          </>
        )}
        {mode !== "edit" && (
          <section className="grid gap-4 rounded-lg border border-border-subtle p-4">
            <Field label="凭据类型">
              <Select
                value={kind}
                disabled={!!entry}
                onValueChange={(k) => {
                  setKind(k as CredentialKind);
                  setIdentifier("");
                  setValue("");
                  setPassphrase("");
                  setDirty(true);
                }}
              >
                {Object.entries(labels).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            {kind !== "secret" && (
              <Field
                label={kind === "access_key_pair" ? "AccessKey ID" : "用户名"}
                required
              >
                <Input
                  required
                  value={identifier}
                  autoComplete="off"
                  onChange={(e) => setIdentifier(e.target.value)}
                />
              </Field>
            )}
            <Field label={secretLabel} required>
              {kind === "ssh_private_key" ? (
                <Textarea
                  required
                  rows={7}
                  spellCheck={false}
                  className="font-mono"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              ) : (
                <Input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              )}
            </Field>
            {kind === "ssh_private_key" && (
              <Field label="私钥口令（可选）">
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </Field>
            )}
          </section>
        )}
      </form>
    </Drawer>
  );
}
