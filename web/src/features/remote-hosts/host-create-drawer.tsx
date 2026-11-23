import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice } from "@/components/feedback";
import { Field, Input, NumberInput, Textarea } from "@/components/fields";
import { Drawer } from "@/components/overlays";
import { SheetClose } from "@/components/ui/sheet";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { ServiceConnection } from "@/types/integrations";

export function HostCreateDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: "",
    code: "",
    description: "",
    host: "",
    port: "22",
    enabled: true,
  });
  const errors = useFormErrors();
  const submission = useSubmission();
  const dirty = Boolean(
    form.name ||
    form.code ||
    form.description ||
    form.host ||
    form.port !== "22" ||
    !form.enabled,
  );
  const markSaved = useUnsaved(dirty, submission.pending);
  function close() {
    markSaved();
    onClose();
  }
  function finish(host: ServiceConnection) {
    markSaved();
    navigate(`/admin/remote-hosts/${host.id}`);
  }
  function validateHost() {
    return errors.validate({
      name: !form.name.trim() ? "请输入主机名称" : "",
      host: !form.host.trim() ? "请输入主机名或 IP" : "",
      port:
        !Number.isInteger(Number(form.port)) ||
        Number(form.port) < 1 ||
        Number(form.port) > 65535
          ? "请输入 1–65535 的整数端口"
          : "",
    });
  }
  async function save() {
    if (
      saving.current ||
      submission.pending ||
      submission.uncertain ||
      !validateHost()
    )
      return;
    saving.current = true;
    try {
      await submission.run(
        async () => {
          const response = await request<ServiceConnection>(
            "/admin/remote-hosts",
            {
              method: "POST",
              body: {
                name: form.name.trim(),
                code: form.code.trim(),
                description: form.description,
                enabled: form.enabled,
                config: { host: form.host, port: Number(form.port) },
              },
            },
          );
          await queryClient.invalidateQueries({
            queryKey: ["remote-host-directory"],
          });
          finish(response.data);
        },
        (error) =>
          errors.show(error, ["name", "code", "host", "port"], {
            "config.host": "host",
            "config.port": "port",
          }),
      );
    } finally {
      saving.current = false;
    }
  }
  return (
    <Drawer
      open
      wide
      title="添加 SSH 主机"
      description="创建后可核对主机公钥并选择首选凭据。"
      dirty={dirty}
      pending={submission.pending}
      onClose={close}
      footer={
        <>
          <SheetClose
            render={
              <Button variant="outline" disabled={submission.pending}>
                取消
              </Button>
            }
          />
          <Button
            type="submit"
            form="host-create-form"
            pending={submission.pending}
            disabled={submission.uncertain}
          >
            创建主机
          </Button>
        </>
      }
    >
      <form
        id="host-create-form"
        noValidate
        ref={errors.formRef}
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        onChange={() => errors.clear()}
      >
        <fieldset
          disabled={submission.pending || submission.uncertain}
          className="min-w-0"
        >
          <ErrorNotice error={errors.error || submission.error} />

          <div className="form-grid">
            <Field label="主机名称" required error={errors.fields.name}>
              <Input
                name="name"
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </Field>
            <Field label="编码（可选）" error={errors.fields.code}>
              <Input
                name="code"
                className="mono"
                value={form.code}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </Field>
            <Field label="主机名 / IP" required error={errors.fields.host}>
              <Input
                name="host"
                autoComplete="off"
                value={form.host}
                onChange={(event) =>
                  setForm({ ...form, host: event.target.value })
                }
              />
            </Field>
            <Field label="SSH 端口" required error={errors.fields.port}>
              <NumberInput
                name="port"
                label="端口"
                min={1}
                max={65535}
                value={form.port}
                disabled={submission.pending}
                onValueChange={(value) => {
                  setForm({ ...form, port: value });
                }}
              />
            </Field>
            <Field label="说明" className="form-full">
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </Field>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />
              创建后启用
            </label>
          </div>
        </fieldset>
      </form>
    </Drawer>
  );
}
