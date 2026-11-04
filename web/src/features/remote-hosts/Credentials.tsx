import { useOperationToast } from "@/components/platform/operation-toast";
import { CredentialStatus } from "@/components/platform/status-text";
import {
  ClipboardList as ActionClipboardList,
  KeyRound as ActionKeyRound,
  Layers as ActionLayers,
  Pencil as ActionPencil,
  ShieldCheck as ActionShieldCheck,
  Star as ActionStar,
  Trash2 as ActionTrash2,
} from "lucide-react";
import { useState } from "react";
import {
  type HostCredential,
  type RemoteHost,
  diagnosticText,
  diagnosticTone,
  type Diagnostic,
  available,
} from "@/shared/remote-hosts";
import { serviceUI } from "@/shared/ssh-providers";
import { useQuery } from "@/lib/use-query";
import { request, errorMessage } from "@/lib/api";
import { useDate } from "@/lib/date";
import { writeReviewMessage } from "@/lib/write-error";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { FormDrawer } from "@/components/platform/form-drawer";
import { FormDialog } from "@/components/platform/form-dialog";
import {
  AsyncState,
  EmptyState,
  ErrorBox,
  RefreshButton,
} from "@/components/platform/feedback";
import { CopyButton } from "@/components/platform/copy-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableRow,
  TableHeader,
  TableBody,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Plus, MoreHorizontal } from "lucide-react";
import { DiagnosticResult } from "./Diagnostics";
import {
  CredentialFields,
  credentialBody,
  credentialDraft,
  credentialErrors,
  authentication,
  clearSecrets,
  type CredentialMode,
} from "./Fields";
type Action = "preferred" | "fallback" | "delete" | "verify" | "diagnostics";
type Target = {
  type: CredentialMode | "command";
  row?: HostCredential;
  command?: Action;
  collection: string;
  preferred: string;
  fallback: string;
  isFallback: boolean;
};
type Pointer = { credential_id: string | null };
export function Credentials({
  base,
  connection,
  system,
  readonly,
}: {
  base: string;
  connection: RemoteHost;
  system: boolean;
  readonly: boolean;
}) {
  const date = useDate(),
    [revision, setRevision] = useState(0),
    [target, setTarget] = useState<Target>(),
    notify = useOperationToast();
  const group = useQuery<{
      items: HostCredential[];
      mutation_version: string;
    }>(base, revision),
    preferred = useQuery<Pointer>(base + "/preferred", revision),
    parent = base.slice(0, -"/credentials".length),
    fallback = useQuery<Pointer>(
      system ? parent + "/fallback-credential" : null,
      revision,
    );
  const mismatch =
    group.data &&
    preferred.data &&
    (group.data.items.find((r) => r.is_preferred)?.id || null) !==
      preferred.data.credential_id;
  const error =
    group.error ||
    preferred.error ||
    fallback.error ||
    (mismatch ? "首选设置已变化，请重新读取。" : "");
  const loading = group.loading || preferred.loading || fallback.loading;
  function refresh() {
    setRevision((v) => v + 1);
  }
  function open(type: Target["type"], row?: HostCredential, command?: Action) {
    if (loading || error) return;
    setTarget({
      type,
      row,
      command,
      collection: group.response?.etag || "",
      preferred: preferred.response?.etag || "",
      fallback: fallback.response?.etag || "",
      isFallback: !!row && fallback.data?.credential_id === row.id,
    });
  }
  function saved() {
    setTarget(undefined);
    notify("凭证设置已更新。");
    refresh();
  }
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">SSH 凭证</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {system
              ? "系统凭证可配置首选和兜底。"
              : "首选凭证适用于当前归属范围。"}
          </p>
        </div>
        <div className="flex gap-2">
          <RefreshButton loading={loading} onClick={refresh} />
          {!readonly && (
            <Button
              disabled={loading || !!error}
              onClick={() => open("create")}
            >
              <Plus />
              添加凭证
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <AsyncState
          loading={loading}
          error={error}
          empty={!group.data?.items.length}
          emptyContent={
            <EmptyState
              title="当前范围还没有 SSH凭证"
              description={
                readonly
                  ? "项目已归档，当前范围的凭证不可新增或修改。"
                  : "添加登录凭证后可验证 SSH 身份；主机公钥信任由系统管理员维护。"
              }
              action={
                !readonly ? (
                  <Button onClick={() => open("create")}>添加凭证</Button>
                ) : undefined
              }
            />
          }
          onRetry={refresh}
        >
          <Table aria-label="SSH 凭证">
            <TableHeader>
              <TableRow>
                {["凭证", "选择策略", "状态", "到期时间", "操作"].map((t) => (
                  <TableHead key={t}>{t}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.data?.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <small className="text-muted-foreground">{r.code}</small>
                  </TableCell>
                  <TableCell>
                    {[
                      r.is_preferred ? "首选" : "",
                      fallback.data?.credential_id === r.id ? "兜底" : "",
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </TableCell>
                  <TableCell>
                    <CredentialStatus
                      enabled={r.enabled}
                      hasSecret={r.has_secret}
                      available={available(r)}
                    />
                  </TableCell>
                  <TableCell>
                    {r.expires_at ? date(r.expires_at) : "长期有效"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={r.name + " 操作"}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => open("command", r, "diagnostics")}
                        >
                          <ActionClipboardList />
                          最近诊断
                        </DropdownMenuItem>
                        {!readonly && (
                          <>
                            <DropdownMenuItem onSelect={() => open("edit", r)}>
                              <ActionPencil />
                              编辑资料
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => open("secret", r)}
                            >
                              <ActionKeyRound />
                              替换认证材料
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!connection.enabled || !available(r)}
                              onSelect={() => open("command", r, "verify")}
                            >
                              <ActionShieldCheck />
                              验证凭证
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={!r.is_preferred && !available(r)}
                              onSelect={() => open("command", r, "preferred")}
                            >
                              <ActionStar />
                              {r.is_preferred ? "取消首选" : "设为首选"}
                            </DropdownMenuItem>
                            {system && (
                              <DropdownMenuItem
                                disabled={
                                  fallback.data?.credential_id !== r.id &&
                                  !available(r)
                                }
                                onSelect={() => open("command", r, "fallback")}
                              >
                                <ActionLayers />
                                {fallback.data?.credential_id === r.id
                                  ? "取消兜底"
                                  : "设为兜底"}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => open("command", r, "delete")}
                            >
                              <ActionTrash2 />
                              删除凭证
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AsyncState>
      </div>
      {target && (
        <CredentialOverlay
          key={target.type + "-" + target.row?.id + "-" + target.command}
          base={base}
          kind={connection.service_type}
          target={target}
          readonly={readonly}
          onClose={() => setTarget(undefined)}
          onSaved={saved}
        />
      )}
    </section>
  );
}
type OverlayProps = {
  base: string;
  kind: string;
  target: Target;
  readonly: boolean;
  onClose: () => void;
  onSaved: () => void;
};
function CredentialOverlay(props: OverlayProps) {
  const { base, target: t, onClose } = props,
    read =
      (!!t.row && ["secret", "edit"].includes(t.type)) ||
      t.command === "delete";
  const detail = useQuery<HostCredential>(read ? base + "/" + t.row!.id : null);
  if (read && !detail.response)
    return (
      <FormDialog
        open
        title="读取凭证"
        onClose={onClose}
        footer={
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        }
      >
        <AsyncState
          loading={detail.loading}
          error={detail.error}
          onRetry={detail.refresh}
        >
          {null}
        </AsyncState>
      </FormDialog>
    );
  return t.type === "command" ? (
    <CredentialCommand {...props} tag={detail.response?.etag} />
  ) : (
    <CredentialEditor
      {...props}
      mode={t.type}
      row={detail.data}
      tag={detail.response?.etag}
    />
  );
}
function CredentialEditor({
  base,
  kind,
  mode,
  row,
  tag,
  target,
  readonly,
  onClose,
  onSaved,
}: OverlayProps & {
  mode: CredentialMode;
  row?: HostCredential;
  tag?: string;
}) {
  const [initial] = useState(() => credentialDraft(kind, row)),
    [draft, setDraft] = useState(initial),
    [version] = useState(tag),
    errors = useFormErrors(),
    save = useSubmission();
  async function submit() {
    if (readonly) return;
    errors.clear();
    if (!errors.validate(credentialErrors(kind, draft, mode))) return;
    await save.submit(
      async () => {
        if (mode === "create")
          await request(base, {
            method: "POST",
            etag: target.collection,
            body: credentialBody(kind, draft),
          });
        else if (mode === "secret")
          await request(base + "/" + row!.id + "/authentication", {
            method: "PUT",
            etag: version,
            body: authentication(kind, draft),
          });
        else
          await request(base + "/" + row!.id, {
            method: "PATCH",
            etag: version,
            body: {
              name: draft.name,
              description: draft.description,
              enabled: draft.enabled,
              expires_at: draft.expires
                ? new Date(draft.expires).toISOString()
                : null,
            },
          });
        onSaved();
      },
      (e) => {
        setDraft((d) => clearSecrets(kind, d));
        errors.show(e, [
          "name",
          "code",
          "expires_at",
          "description",
          ...Object.keys(draft.values),
        ]);
      },
    );
  }
  return (
    <FormDrawer
      title={
        mode === "create"
          ? "添加凭证"
          : mode === "edit"
            ? "编辑凭证资料"
            : "替换认证材料"
      }
      description={row?.name || serviceUI[kind]!.authLabel}
      dirty={JSON.stringify(initial) !== JSON.stringify(draft)}
      pending={save.pending}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            variant="outline"
            disabled={save.pending}
            onClick={() => close()}
          >
            取消
          </Button>
          <Button
            disabled={readonly || save.pending || save.blocked}
            type="submit"
            form="credential-form"
          >
            {save.pending ? "正在保存…" : "保存凭证"}
          </Button>
        </>
      )}
    >
      <form
        id="credential-form"
        ref={errors.formRef}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="space-y-4"
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {save.blocked && (
          <p role="alert">{writeReviewMessage}认证秘密需重新输入。</p>
        )}
        <fieldset disabled={readonly || save.pending || save.blocked}>
          <CredentialFields
            kind={kind}
            mode={mode}
            draft={draft}
            update={setDraft}
            errors={errors.fields}
          />
        </fieldset>
      </form>
    </FormDrawer>
  );
}
function CredentialCommand({
  base,
  target: t,
  readonly,
  tag,
  onClose,
  onSaved,
}: OverlayProps & { tag?: string }) {
  const r = t.row!,
    action = t.command!,
    [error, setError] = useState(""),
    [result, setResult] = useState<Diagnostic>(),
    save = useSubmission();
  const history = useQuery<{ latest: Diagnostic | null }>(
    action === "diagnostics" ? base + "/" + r.id + "/diagnostics" : null,
  );
  const titles = {
    delete: "删除凭证",
    preferred: r.is_preferred ? "取消首选" : "设为首选",
    fallback: t.isFallback ? "取消兜底" : "设为兜底",
    diagnostics: "最近诊断",
    verify: "验证凭证",
  };
  const notify = useOperationToast();
  async function run() {
    if (readonly) return;
    setError("");
    await save.submit(
      async () => {
        if (action === "delete")
          await request(base + "/" + r.id, {
            method: "DELETE",
            etag: tag,
            headers: { "X-Collection-If-Match": t.collection },
          });
        else if (action === "verify") {
          notify("正在验证凭证。", "info");
          const { data: diagnostic } = await request<Diagnostic>(
            base + "/" + r.id + "/verify",
            {
              method: "POST",
              etag: '"' + r.version + '"',
              body: {},
            },
          );
          setResult(diagnostic);
          const tone = diagnosticTone(diagnostic);
          notify(
            diagnosticText(diagnostic),
            tone === "muted" ? "warning" : tone,
          );
          return;
        } else if (action === "preferred" || action === "fallback") {
          const clear = action === "preferred" ? r.is_preferred : t.isFallback;
          const path =
            action === "preferred"
              ? base + "/preferred"
              : base.slice(0, -"/credentials".length) + "/fallback-credential";
          await request(path, {
            method: clear ? "DELETE" : "PUT",
            etag: action === "preferred" ? t.preferred : t.fallback,
            body: clear ? undefined : { credential_id: r.id },
          });
        }
        onSaved();
      },
      (e) => setError(errorMessage(e)),
    );
  }
  return (
    <FormDialog
      open
      title={titles[action]}
      description={r.name}
      pending={save.pending}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" disabled={save.pending} onClick={onClose}>
            {action === "diagnostics" || result ? "关闭" : "取消"}
          </Button>
          {action !== "diagnostics" && !result && (
            <Button
              variant={action === "delete" ? "destructive" : "default"}
              disabled={readonly || save.pending || save.blocked}
              onClick={() => void run()}
            >
              {save.pending ? "处理中…" : "确认"}
            </Button>
          )}
        </>
      }
    >
      <ErrorBox>{error}</ErrorBox>
      {save.blocked && <p role="alert">{writeReviewMessage}</p>}
      {action === "diagnostics" ? (
        <AsyncState
          loading={history.loading}
          error={history.error}
          onRetry={history.refresh}
        >
          <DiagnosticResult value={history.data?.latest || null} />
        </AsyncState>
      ) : result ? (
        <DiagnosticResult value={result} />
      ) : (
        <p className="text-sm">
          {action === "delete"
            ? "删除后认证材料不可恢复，关联的首选与兜底设置将清除。"
            : action === "verify"
              ? "使用已保存的认证材料向主机发起 SSH 认证验证。"
              : "此操作将更新当前归属范围内的凭证选择策略。"}{" "}
        </p>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {r.code}
        <CopyButton value={r.code} label="复制凭证编码" />
      </div>
    </FormDialog>
  );
}
