import { useRef, useState } from "react";
import { ApiError, isVersionConflict, request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import {
  Field,
  Input,
  NumberInput,
  Select,
  Textarea,
} from "@/components/fields";
import { Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { ProviderDefinition } from "@/domain/service-providers";
import type { ServiceConnection } from "@/types/integrations";

export function IntegrationError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="grid gap-2">
      <ErrorNotice error={error instanceof ApiError ? error.message : error} />
      {error instanceof ApiError && (
        <details className="text-xs text-muted">
          <summary className="cursor-pointer">技术详情</summary>
          <p className="mt-2 break-all font-mono">
            {error.code}
            {error.requestId ? ` · ${error.requestId}` : ""}
          </p>
        </details>
      )}
    </div>
  );
}
function draftFor(connection: ServiceConnection, provider: ProviderDefinition) {
  return {
    name: connection.name,
    description: connection.description,
    config: Object.fromEntries(
      provider.configFields.map((field) => [
        field.key,
        String(
          connection.config?.[
            field.key as keyof NonNullable<ServiceConnection["config"]>
          ] ?? "",
        ),
      ]),
    ),
  };
}
export function ConnectionEditor({
  path,
  provider,
  onClose,
  onSaved,
}: {
  path: string;
  provider: ProviderDefinition;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [returnFocus] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const initial = useQuery({
    queryKey: ["connection-editor", path],
    queryFn: () => request<ServiceConnection>(path),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  return initial.data && !initial.isFetching && !initial.error ? (
    <LoadedEditor
      restoreFocusTo={returnFocus}
      initial={initial.data.data}
      initialEtag={initial.data.etag}
      path={path}
      provider={provider}
      onClose={onClose}
      onSaved={onSaved}
    />
  ) : (
    <Drawer
      open
      wide
      title="编辑连接配置"
      onClose={onClose}
      restoreFocusTo={returnFocus}
    >
      <AsyncBoundary
        loading={initial.isFetching || initial.isPending}
        error={initial.error}
        onRetry={() => void initial.refetch()}
      />
    </Drawer>
  );
}
function LoadedEditor({
  restoreFocusTo,
  initial,
  initialEtag,
  path,
  provider,
  onClose,
  onSaved,
}: {
  restoreFocusTo: HTMLElement | null;
  initial: ServiceConnection;
  initialEtag: string;
  path: string;
  provider: ProviderDefinition;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [baseline, setBaseline] = useState(() => draftFor(initial, provider));
  const [form, setForm] = useState(baseline);
  const [etag, setEtag] = useState(initialEtag);
  const [latest, setLatest] = useState<ServiceConnection | null>(null);
  const [reloading, setReloading] = useState(false);
  const [readError, setReadError] = useState<unknown>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [caOpen, setCaOpen] = useState(Boolean(form.config.custom_ca_pem));
  const errors = useFormErrors();
  const submission = useSubmission();
  const saving = useRef(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const pending = submission.pending || reloading;
  const needsReload = !etag || isVersionConflict(submission.error);
  const markSaved = useUnsaved(dirty || submission.uncertain, pending);
  function close() {
    markSaved();
    onClose();
  }
  function change(key: string, value: string, config = false) {
    errors.change(key);
    setForm(
      config
        ? { ...form, config: { ...form.config, [key]: value } }
        : { ...form, [key]: value },
    );
  }
  function validate() {
    const fields: Record<string, string> = {};
    if (!form.name.trim() || Array.from(form.name.trim()).length > 100)
      fields.name = "请输入 1–100 个字符的连接名称";
    if (Array.from(form.description).length > 1000)
      fields.description = "说明不能超过 1000 个字符";
    for (const field of provider.configFields)
      if (field.key !== "custom_ca_pem" && !form.config[field.key]?.trim())
        fields[field.key] = `请输入${field.label}`;
    if (
      provider.defaultPort &&
      (!/^\d+$/.test(form.config.port) ||
        Number(form.config.port) < 1 ||
        Number(form.config.port) > 65535)
    )
      fields.port = "请输入 1–65535 的整数端口";
    if (form.config.base_url) {
      try {
        const url = new URL(form.config.base_url);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          form.config.base_url.length > 2048
        )
          throw new Error();
      } catch {
        fields.base_url =
          "请输入完整 HTTP 或 HTTPS 地址，不包含账号、查询参数或锚点";
      }
    }
    if (new TextEncoder().encode(form.config.custom_ca_pem).length > 16384) {
      fields.custom_ca_pem = "公共 CA 不能超过 16 KiB";
      setCaOpen(true);
    }
    return errors.validate(fields);
  }
  async function reload() {
    if (saving.current || pending) return;
    setReloading(true);
    setReadError(null);
    try {
      const result = await request<ServiceConnection>(path);
      if (submission.uncertain) {
        const actual = draftFor(result.data, provider);
        const expected = { ...form, name: form.name.trim() };
        if (JSON.stringify(actual) === JSON.stringify(expected)) {
          await onSaved();
          close();
        } else {
          setLatest(result.data);
          setUnconfirmed(true);
        }
      } else {
        setLatest(result.data);
        setBaseline(draftFor(result.data, provider));
        setEtag(result.etag);
        submission.setError(null);
        errors.clear();
      }
    } catch (error) {
      setReadError(error);
    } finally {
      setReloading(false);
    }
  }
  async function save() {
    if (
      saving.current ||
      pending ||
      submission.uncertain ||
      needsReload ||
      !dirty ||
      !validate()
    )
      return;
    saving.current = true;
    try {
      await submission.run(
        async () => {
          await request(path, {
            method: "PATCH",
            etag,
            body: {
              name: form.name.trim(),
              description: form.description,
              config: provider.configBody(form.config),
            },
          });
          await onSaved();
          close();
        },
        (error) => {
          if (
            error.details.some((item) => item.field === "config.custom_ca_pem")
          )
            setCaOpen(true);
          errors.show(
            error,
            [
              "name",
              "description",
              ...provider.configFields.map((field) => field.key),
            ],
            Object.fromEntries(
              provider.configFields.map((field) => [
                `config.${field.key}`,
                field.key,
              ]),
            ),
          );
        },
      );
    } finally {
      saving.current = false;
    }
  }
  return (
    <Drawer
      restoreFocusTo={restoreFocusTo}
      open
      wide
      title="编辑连接配置"
      description={`${provider.name} · 保存后需重新核对诊断结果`}
      dirty={dirty || submission.uncertain}
      pending={pending}
      onClose={close}
      footer={
        <>
          <SheetClose asChild>
            <Button variant="outline" disabled={pending}>
              取消
            </Button>
          </SheetClose>
          <Button
            type="submit"
            form="connection-edit-form"
            pending={submission.pending}
            disabled={!dirty || pending || needsReload || submission.uncertain}
          >
            保存配置
          </Button>
        </>
      }
    >
      <form
        id="connection-edit-form"
        ref={errors.formRef}
        noValidate
        className="grid gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <IntegrationError error={submission.error} />
        {(needsReload || submission.uncertain) && (
          <Notice tone="warning">
            {submission.uncertain
              ? "保存结果尚未确认，核实前不会重复提交。"
              : "配置版本缺失或已变化。重新加载后保留草稿，请核对当前值再保存。"}
            <Button
              className="mt-3"
              variant="outline"
              pending={reloading}
              onClick={() => void reload()}
            >
              {submission.uncertain ? "核实保存结果" : "重新加载配置"}
            </Button>
          </Notice>
        )}
        <IntegrationError error={readError} />
        {latest && (
          <Notice tone={unconfirmed ? "warning" : "info"}>
            {unconfirmed
              ? "当前配置与本次草稿不一致，结果仍待确认，请稍后再次核实。"
              : "已重新加载，草稿已保留。请与以下当前配置核对后再保存。"}
            <details className="mt-2">
              <summary className="cursor-pointer">查看当前已保存配置</summary>
              <dl className="mt-3 grid gap-2 break-words">
                <div>名称：{latest.name}</div>
                <div className="whitespace-pre-wrap">
                  说明：{latest.description || "无"}
                </div>
                {provider.configFields.map((field) => (
                  <div key={field.key}>
                    {field.label}：
                    {field.key === "custom_ca_pem"
                      ? latest.config?.custom_ca_pem
                        ? "已配置公共 CA"
                        : "系统信任"
                      : String(
                          latest.config?.[
                            field.key as keyof NonNullable<
                              ServiceConnection["config"]
                            >
                          ] ?? "未设置",
                        )}
                  </div>
                ))}
              </dl>
            </details>
          </Notice>
        )}
        <fieldset
          disabled={pending || submission.uncertain}
          className="grid min-w-0 gap-5"
        >
          <Field label="连接名称" required error={errors.fields.name}>
            <Input
              name="name"
              value={form.name}
              onChange={(event) => change("name", event.target.value)}
            />
          </Field>
          <Field label="连接编码" hint="创建后不可修改">
            <Input readOnly value={initial.code} className="font-mono" />
          </Field>
          <div
            className={
              provider.defaultPort
                ? "grid grid-cols-[minmax(0,1fr)_150px] gap-4"
                : "grid gap-4"
            }
          >
            {provider.configFields
              .filter((field) => field.key !== "custom_ca_pem")
              .map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  required
                  error={errors.fields[field.key]}
                  className={
                    provider.defaultPort &&
                    !["host", "port"].includes(field.key)
                      ? "col-span-2"
                      : undefined
                  }
                >
                  {field.options ? (
                    <Select
                      name={field.key}
                      value={form.config[field.key]}
                      onValueChange={(value) => change(field.key, value, true)}
                    >
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : field.key === "port" ? (
                    <NumberInput
                      name="port"
                      label="端口"
                      min={1}
                      max={65535}
                      value={form.config.port}
                      disabled={pending || submission.uncertain}
                      onValueChange={(value) => change("port", value, true)}
                    />
                  ) : (
                    <Input
                      name={field.key}
                      value={form.config[field.key]}
                      onChange={(event) =>
                        change(field.key, event.target.value, true)
                      }
                    />
                  )}
                </Field>
              ))}
          </div>
          <details
            open={caOpen}
            onToggle={(event) => setCaOpen(event.currentTarget.open)}
            className="rounded-lg border p-3"
          >
            <summary className="cursor-pointer text-sm">
              自定义公共 CA（可选）
            </summary>
            <div className="mt-4">
              <Field
                label="公共 CA"
                hint="仅填写 PEM 公共证书，不填写私钥。数据库需启用 TLS 校验才使用 CA。"
                error={errors.fields.custom_ca_pem}
              >
                <Textarea
                  name="custom_ca_pem"
                  rows={5}
                  className="font-mono"
                  value={form.config.custom_ca_pem}
                  onChange={(event) =>
                    change("custom_ca_pem", event.target.value, true)
                  }
                />
              </Field>
            </div>
          </details>
          <Field label="说明" error={errors.fields.description}>
            <Textarea
              name="description"
              rows={4}
              value={form.description}
              onChange={(event) => change("description", event.target.value)}
            />
          </Field>
        </fieldset>
      </form>
    </Drawer>
  );
}
