import { useState } from "react";
import { Link, useLocation } from "react-router";
import { KeyRound } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Field, Select } from "@/components/fields";
import { useApiQuery } from "@/hooks/use-api";
import { useSubmission } from "@/hooks/use-form";
import {
  diagnosticText,
  type ProviderDefinition,
} from "@/domain/service-providers";
import type {
  CredentialSet,
  Selection,
  Diagnostic,
} from "@/types/integrations";

export function CredentialPanel({
  base,
  provider,
  readonly = false,
}: {
  base: string;
  provider: ProviderDefinition;
  readonly?: boolean;
}) {
  const list = useApiQuery<CredentialSet>(["credentials", base], base);
  const selection = useApiQuery<Selection>(
    ["preferred", base],
    base + "/preferred",
  );
  const current = selection.data?.data.credential_id ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? current;
  const selected = list.data?.data.items.find((c) => c.id === current);
  const mutation = useSubmission();
  const location = useLocation();
  const scope = base.split(/\/(?:remote-hosts|service-connections)\//)[0] ?? "";
  const catalog =
    scope === "/me"
      ? "/account/credentials"
      : scope.startsWith("/projects") && location.pathname.startsWith("/admin/")
        ? "/admin" + scope + "/credentials"
        : scope + "/credentials";
  const diagnosticPath = base + "/" + current + "/diagnostics";
  const diagnostic = useApiQuery<{ latest: Diagnostic | null }>(
    ["preferred-diagnostic", diagnosticPath, selected?.version],
    diagnosticPath,
    { enabled: Boolean(current) },
  );
  const latest = diagnostic.data?.data.latest;
  const reload = async () => {
    await Promise.all([list.refetch(), selection.refetch()]);
    setDraft(null);
    mutation.setError(null);
  };
  return (
    <section className="panel max-w-5xl">
      <div className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4 border-b border-border-subtle pb-4">
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <KeyRound className="size-4 text-primary" />
              首选凭据
            </h3>
            <p className="mt-2 text-sm text-muted">
              选择当前范围访问此{provider.type === "ssh" ? "主机" : "连接"}
              时使用的身份。
            </p>
          </div>
          <Link to={catalog} className="shrink-0 text-sm text-primary">
            管理凭据 →
          </Link>
        </div>
        <AsyncBoundary
          loading={list.isPending || selection.isPending}
          error={list.error || selection.error}
          onRetry={() => void reload()}
        >
          <div className="mt-5 grid max-w-3xl gap-4">
            <Field label="首选凭据">
              <Select
                value={value}
                disabled={readonly || mutation.pending}
                onValueChange={setDraft}
              >
                <option value="">未设置</option>
                {list.data?.data.items.map((c) => {
                  const available =
                    c.enabled &&
                    (!c.expires_at || Date.parse(c.expires_at) > Date.now());
                  return (
                    <option key={c.id} value={c.id} disabled={!available}>
                      {c.name} · {c.code}
                      {available ? "" : "（不可用）"}
                    </option>
                  );
                })}
              </Select>
            </Field>
            {!list.data?.data.items.length && (
              <Notice>当前范围还没有适用于 {provider.name} 的凭据。</Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  readonly ||
                  value === current ||
                  !selection.data?.etag ||
                  mutation.pending ||
                  mutation.uncertain
                }
                onClick={() =>
                  void mutation.run(async () => {
                    await request(base + "/preferred", {
                      method: value ? "PUT" : "DELETE",
                      etag: selection.data?.etag,
                      body: value ? { credential_id: value } : undefined,
                    });
                    await selection.refetch();
                    setDraft(null);
                  })
                }
              >
                保存首选
              </Button>
              {selected && (
                <Button
                  variant="outline"
                  disabled={
                    readonly ||
                    value !== current ||
                    !selected.enabled ||
                    Boolean(
                      selected.expires_at &&
                      Date.parse(selected.expires_at) <= Date.now(),
                    ) ||
                    mutation.pending
                  }
                  onClick={() =>
                    void mutation.run(async () => {
                      await request(base + "/" + current + "/verify", {
                        method: "POST",
                        etag: '"' + selected.version + '"',
                        body: {},
                      });
                      await diagnostic.refetch();
                    })
                  }
                >
                  验证凭据
                </Button>
              )}
              {Boolean(mutation.error) && (
                <Button variant="outline" onClick={() => void reload()}>
                  重新加载
                </Button>
              )}
            </div>
            <ErrorNotice error={mutation.error || diagnostic.error} />
            {latest && <Notice>{diagnosticText(latest)}</Notice>}
          </div>
        </AsyncBoundary>
      </div>
    </section>
  );
}
