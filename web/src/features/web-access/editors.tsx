import { useState } from "react";
import type { ApiResponse } from "@/api/client";
import { Button } from "@/components/button";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { Notice } from "@/components/feedback";
import { Drawer, OverlayCancelButton, Modal } from "@/components/overlays";
import { Switch } from "@/components/ui/switch";
import { useUnsaved } from "@/hooks/use-unsaved";
import { useFormErrors } from "@/hooks/use-form";
import type {
  WebAccessProvider,
  WebAccessCatalog,
} from "@/types/agent-resources";
import { useWebWrite } from "./write";
import { useResourceSave } from "@/features/agents/resources/admin-shared";

export function ProviderEditor({
  initial,
  catalog,
  onClose,
  onSaved,
}: {
  initial?: ApiResponse<WebAccessProvider>;
  catalog: WebAccessCatalog;
  onClose: () => void;
  onSaved: (p: WebAccessProvider) => void;
}) {
  const defaultURL = (type: string) => {
    const properties = catalog.items.find((item) => item.provider_type === type)
      ?.configuration_schema.properties as
      Record<string, { default?: unknown }> | undefined;
    return typeof properties?.base_url?.default === "string"
      ? properties.base_url.default
      : "";
  };
  const [draft, setDraft] = useState({
    name: initial?.data.name ?? "",
    description: initial?.data.description ?? "",
    provider_type:
      initial?.data.provider_type ??
      catalog.items[0]?.provider_type ??
      "deepseek",
    enabled: initial?.data.enabled ?? true,
    config: initial?.data.config ?? {
      base_url: defaultURL(catalog.items[0]?.provider_type ?? "deepseek"),
      timeout_seconds: 15,
    },
  });
  const [baseline, setBaseline] = useState(draft),
    [secret, setSecret] = useState("");
  const errors = useFormErrors();
  const show = (error: unknown) =>
    errors.show(error, [
      "name",
      "description",
      "config.base_url",
      "config.timeout_seconds",
      "authentication.secret.value",
    ]);
  const create = useWebWrite<WebAccessProvider>(show);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(baseline) || Boolean(secret);
  const save = useResourceSave({
    initial: initial ?? {
      data: { version: "" } as WebAccessProvider,
      etag: "unused",
      status: 200,
    },
    path: `/admin/web-access/providers/${initial?.data.id ?? ""}`,
    dirty: Boolean(initial) && dirty,
    adopt: (value) => {
      const updated = {
        name: value.name,
        description: value.description,
        provider_type: value.provider_type,
        enabled: value.enabled,
        config: value.config,
      };
      setDraft(updated);
      setBaseline(updated);
    },
    complete: onSaved,
    showError: show,
  });
  const pending = initial ? save.pending : create.pending,
    blocked = initial ? save.blocked : create.uncertain;
  const release = useUnsaved(!initial && dirty, pending);
  return (
    <Drawer
      open
      wide
      title={initial ? "提供商设置" : "新建网络检索提供商"}
      onClose={() => {
        if (!initial) release();
        onClose();
      }}
      dirty={dirty || blocked}
      pending={pending}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            type="submit"
            form="web-provider-form"
            pending={pending}
            disabled={blocked || (!dirty && Boolean(initial))}
          >
            {initial ? "保存配置" : "创建提供商"}
          </Button>
        </>
      }
    >
      <form
        id="web-provider-form"
        ref={errors.formRef}
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          errors.clear();
          if (initial)
            void save.save({
              name: draft.name,
              description: draft.description,
              enabled: draft.enabled,
              config: draft.config,
            });
          else
            void create.run(
              "/providers",
              {
                method: "POST",
                body: {
                  ...draft,
                  authentication: {
                    auth_method: "api_key",
                    secret: { operation: "replace", value: secret },
                  },
                },
              },
              (response) => {
                release();
                setSecret("");
                onSaved(response.data);
              },
            );
        }}
      >
        {initial ? save.recovery : create.recovery}
        <fieldset disabled={pending || blocked} className="space-y-5">
          <Field label="名称" required error={errors.fields.name}>
            <Input
              name="name"
              required
              maxLength={100}
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 items-start gap-5">
            <Field label="服务类型">
              <Select
                value={draft.provider_type}
                disabled={Boolean(initial)}
                onValueChange={(value) => {
                  const type = value as "deepseek" | "glm";
                  setDraft({
                    ...draft,
                    provider_type: type,
                    config: {
                      ...draft.config,
                      base_url:
                        draft.config.base_url ===
                        defaultURL(draft.provider_type)
                          ? defaultURL(type)
                          : draft.config.base_url,
                    },
                  });
                }}
              >
                {catalog.items.map((type) => (
                  <option key={type.provider_type} value={type.provider_type}>
                    {type.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="超时（秒）"
              error={errors.fields["config.timeout_seconds"]}
            >
              <Input
                name="config.timeout_seconds"
                type="number"
                required
                min={1}
                max={60}
                value={draft.config.timeout_seconds}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    config: {
                      ...draft.config,
                      timeout_seconds: Number(e.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
          <Field
            label="服务地址"
            required
            error={errors.fields["config.base_url"]}
            hint="已投入使用的提供商不能原地更换服务目标。"
          >
            <Input
              name="config.base_url"
              type="url"
              required
              maxLength={2048}
              value={draft.config.base_url}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  config: { ...draft.config, base_url: e.target.value },
                })
              }
            />
          </Field>
          {!initial && (
            <Field
              label="API Key"
              required
              error={errors.fields["authentication.secret.value"]}
            >
              <Input
                name="authentication.secret.value"
                type="password"
                autoComplete="new-password"
                required
                maxLength={8192}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          )}
          <Field label="说明" error={errors.fields.description}>
            <Textarea
              name="description"
              rows={4}
              maxLength={1000}
              value={draft.description}
              onChange={(e) =>
                setDraft({ ...draft, description: e.target.value })
              }
            />
          </Field>
          <label className="flex items-center gap-3 text-sm">
            <Switch
              checked={draft.enabled}
              onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
            />
            启用提供商
          </label>
        </fieldset>
      </form>
    </Drawer>
  );
}

export function AuthenticationEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: ApiResponse<WebAccessProvider>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [secret, setSecret] = useState(""),
    [operation, setOperation] = useState("replace");
  const write = useWebWrite<WebAccessProvider>();
  const dirty = Boolean(secret) || operation === "clear";
  const release = useUnsaved(dirty, write.pending || write.uncertain);
  return (
    <Drawer
      open
      title="管理认证"
      description={initial.data.name}
      onClose={onClose}
      dirty={dirty || write.uncertain}
      pending={write.pending}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            form="web-auth-form"
            type="submit"
            pending={write.pending}
            disabled={write.uncertain || !dirty}
          >
            保存认证
          </Button>
        </>
      }
    >
      <form
        id="web-auth-form"
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void write.run(
            `/providers/${initial.data.id}/authentication`,
            {
              method: "PUT",
              etag: write.etag ?? initial.etag,
              body: {
                auth_method: "api_key",
                secret: {
                  operation,
                  ...(operation === "replace" ? { value: secret } : {}),
                },
              },
            },
            () => {
              setSecret("");
              release();
              onSaved();
              onClose();
            },
          );
        }}
      >
        {write.recovery}
        <fieldset
          className="space-y-5"
          disabled={write.pending || write.uncertain}
        >
          <Field label="操作">
            <Select value={operation} onValueChange={setOperation}>
              <option value="replace">替换 API Key</option>
              <option value="clear">清除 API Key</option>
            </Select>
          </Field>
          {operation === "replace" ? (
            <Field label="新 API Key" required>
              <Input
                type="password"
                autoComplete="new-password"
                required
                maxLength={8192}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
              />
            </Field>
          ) : (
            <Notice tone="warning">
              清除后，此提供商将无法提供需要认证的检索能力。
            </Notice>
          )}
          <p className="text-sm text-muted">
            密钥不会回显。存在密钥不代表本次替换已经成功。
          </p>
        </fieldset>
      </form>
    </Drawer>
  );
}

export function DeleteProvider({
  initial,
  onClose,
  onDeleted,
}: {
  initial: ApiResponse<WebAccessProvider>;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const write = useWebWrite<null>();
  return (
    <Modal
      open
      title="删除提供商"
      description={initial.data.name}
      onClose={onClose}
      pending={write.pending}
      dirty={write.uncertain}
      footer={
        <>
          <OverlayCancelButton />
          <Button
            variant="danger"
            disabled={write.uncertain}
            pending={write.pending}
            onClick={() =>
              void write.run(
                `/providers/${initial.data.id}`,
                { method: "DELETE", etag: write.etag ?? initial.etag },
                onDeleted,
              )
            }
          >
            删除提供商
          </Button>
        </>
      }
    >
      <p className="text-sm">
        删除提供商及其认证与最近诊断。被检索设置引用、正在调用或测试的提供商无法删除，请先解除引用或等待执行结束。
      </p>
      {write.recovery}
    </Modal>
  );
}
