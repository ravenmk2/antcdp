import { TemporaryFiles } from "./TemporaryFiles";
import { useOperationToast } from "@/components/platform/operation-toast";
import { useRef, useState } from "react";
import { useRevalidator, useSearchParams } from "react-router";
import { adminLoader } from "@/lib/loaders";
import { invalidateIdentity, type Identity } from "@/app/identity";
import { request, errorMessage } from "@/lib/api";
import { useQuery } from "@/lib/use-query";
import { writeRequiresReview, writeReviewMessage } from "@/lib/write-error";
import { SettingsFrame } from "@/components/platform/settings-frame";
import { useNavigationProtection } from "@/components/platform/navigation-guard";
import { Field } from "@/components/platform/field";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { AsyncState, ErrorBox } from "@/components/platform/feedback";
import { FormDialog } from "@/components/platform/form-dialog";
import { NativeSelect } from "@/components/platform/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { siteNameHelp, validateSiteName } from "@/shared/validation";
export const loader = adminLoader;
export type Settings = Identity["settings"] & {
  version: string;
  deployment: { public_url: string };
};
export function Component() {
  const [params] = useSearchParams();
  const tab = ["access", "system", "maintenance"].includes(
    params.get("tab") || "",
  )
    ? params.get("tab")!
    : "general";
  const query = useQuery<Settings>("/admin/settings"),
    revalidator = useRevalidator();
  const notify = useOperationToast();
  return (
    <SettingsFrame
      title="系统设置"
      links={[
        { label: "基本设置", to: "/admin/settings", active: tab === "general" },
        {
          label: "注册与会话",
          to: "/admin/settings?tab=access",
          active: tab === "access",
        },
        {
          label: "运行信息",
          to: "/admin/settings?tab=system",
          active: tab === "system",
        },
        {
          label: "临时文件",
          to: "/admin/settings?tab=maintenance",
          active: tab === "maintenance",
        },
      ]}
    >
      {tab === "maintenance" ? (
        <TemporaryFiles />
      ) : tab === "system" ? (
        <SystemInfo />
      ) : (
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={query.refresh}
        >
          {query.data && (
            <SettingsForm
              key={tab + query.response?.etag}
              tab={tab}
              initial={query.data}
              etag={query.response?.etag || ""}
              onReload={query.refresh}
              onSaved={() => {
                notify("系统设置已保存。");
                query.refresh();
                invalidateIdentity();
                void revalidator.revalidate();
              }}
            />
          )}
        </AsyncState>
      )}
    </SettingsFrame>
  );
}
export function SettingsForm({
  initial,
  etag,
  tab,
  onSaved,
  onReload,
}: {
  initial: Settings;
  etag: string;
  tab: string;
  onSaved: () => void;
  onReload: () => void;
}) {
  const [form, setForm] = useState({
    site_name: initial.site_name,
    timezone: initial.timezone,
    registration_enabled: initial.registration_enabled,
    session_ttl_days: initial.session_ttl_days,
  });
  const original = {
    site_name: initial.site_name,
    timezone: initial.timezone,
    registration_enabled: initial.registration_enabled,
    session_ttl_days: initial.session_ttl_days,
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  const [busy, setBusy] = useState(false),
    [blocked, setBlocked] = useState(false),
    [reload, setReload] = useState(false),
    locked = useRef(false),
    errors = useFormErrors();
  useNavigationProtection(busy ? "pending" : dirty ? "dirty" : undefined);
  const timezones = [
    ...new Set([
      initial.timezone,
      "Asia/Shanghai",
      "UTC",
      ...(typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : []),
    ]),
  ];
  async function save() {
    if (locked.current || blocked || !dirty) return;
    errors.clear();
    const fields: Record<string, string> = {};
    if (tab === "general") {
      fields.site_name = validateSiteName(form.site_name);
      if (!timezones.includes(form.timezone))
        fields.timezone = "请选择有效时区。";
    } else if (
      !Number.isInteger(form.session_ttl_days) ||
      form.session_ttl_days < 1 ||
      form.session_ttl_days > 30
    )
      fields.session_ttl_days = "会话闲置有效期须为 1–30 天。";
    if (!errors.validate(fields)) return;
    if (!etag) {
      errors.setError("版本信息缺失，请重新读取。");
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      await request<Settings>("/admin/settings", {
        method: "PATCH",
        etag,
        body:
          tab === "general"
            ? { site_name: form.site_name.trim(), timezone: form.timezone }
            : {
                registration_enabled: form.registration_enabled,
                session_ttl_days: form.session_ttl_days,
              },
      });
      onSaved();
    } catch (e) {
      errors.show(e, [
        "site_name",
        "timezone",
        "session_ttl_days",
        "registration_enabled",
      ]);
      setBlocked(writeRequiresReview(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <form
        ref={errors.formRef}
        noValidate
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <ErrorBox>{errors.error}</ErrorBox>
        {blocked && (
          <div className="space-y-3">
            <p role="alert" className="text-sm">
              {writeReviewMessage}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReload(true)}
            >
              重新读取最新配置
            </Button>
          </div>
        )}
        <fieldset disabled={busy} className="space-y-6">
          {tab === "general" ? (
            <>
              <Field
                label="系统名称"
                hint={siteNameHelp}
                error={errors.fields.site_name}
              >
                {(props) => (
                  <Input
                    {...props}
                    value={form.site_name}
                    onChange={(e) => {
                      setForm((f) => ({ ...f, site_name: e.target.value }));
                      errors.setFields((f) => ({ ...f, site_name: "" }));
                    }}
                  />
                )}
              </Field>
              <Field label="访问地址" hint="由部署配置指定。">
                {(props) => (
                  <Input
                    {...props}
                    readOnly
                    value={initial.deployment.public_url}
                  />
                )}
              </Field>
              <Field
                label="系统时区"
                required
                hint="用于系统日期与审计记录显示。"
                error={errors.fields.timezone}
              >
                {(props) => (
                  <NativeSelect
                    {...props}
                    value={form.timezone}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, timezone: e.target.value }))
                    }
                  >
                    {timezones.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </>
          ) : (
            <>
              <Field
                label="允许用户自主注册"
                hint="开启后可注册普通账号，无需审批。关闭仅阻止新注册，不影响已有账号。"
                error={errors.fields.registration_enabled}
              >
                {(props) => (
                  <Switch
                    {...props}
                    className="ml-3"
                    checked={form.registration_enabled}
                    onCheckedChange={(value) =>
                      setForm((f) => ({ ...f, registration_enabled: value }))
                    }
                  />
                )}
              </Field>
              <Field
                label="会话闲置有效期"
                hint="有效访问时自动续期；修改只影响新会话。禁用账号或重置密码会撤销已有会话。"
                error={errors.fields.session_ttl_days}
              >
                {(props) => (
                  <NativeSelect
                    {...props}
                    value={form.session_ttl_days}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        session_ttl_days: Number(e.target.value),
                      }))
                    }
                  >
                    {Array.from({ length: 30 }, (_, i) => (
                      <option value={i + 1} key={i}>
                        {i + 1} 天
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            </>
          )}
        </fieldset>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-5">
          <span className="mr-auto text-sm text-muted-foreground">
            {dirty ? "有未保存的修改" : "当前分类已保存"}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !dirty}
            onClick={() => {
              setForm(original);
              errors.clear();
            }}
          >
            撤销修改
          </Button>
          <Button disabled={busy || blocked || !dirty}>
            {busy ? "正在保存…" : "保存当前分类"}
          </Button>
        </div>
      </form>
      <FormDialog
        open={reload}
        title="重新读取配置"
        description="将丢弃当前草稿，读取服务端最新配置。"
        onClose={() => setReload(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setReload(false)}>
              继续编辑
            </Button>
            <Button onClick={onReload}>放弃草稿并重新读取</Button>
          </>
        }
      >
        {null}
      </FormDialog>
    </>
  );
}
function SystemInfo() {
  const query = useQuery<{
    version: string;
    data_directory: string;
    database_type: string;
    master_key_initialized: boolean;
  }>("/admin/system-info");
  const [busy, setBusy] = useState(false),
    notify = useOperationToast(),
    [error, setError] = useState("");
  const locked = useRef(false);
  async function check() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    notify("正在检测数据库连接。", "info");
    try {
      await request("/admin/system-info/database-check", {
        method: "POST",
        body: {},
      });
      notify("数据库连接正常。");
    } catch (e) {
      notify("数据库连接检测未完成，请查看原因。", "danger");
      setError(errorMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <AsyncState
      loading={query.loading}
      error={query.error}
      onRetry={query.refresh}
    >
      {query.data && (
        <div className="space-y-8">
          <dl className="grid gap-6 sm:grid-cols-2">
            {[
              ["运行版本", query.data.version],
              ["数据目录", query.data.data_directory],
              ["数据库", query.data.database_type],
              [
                "主密钥",
                query.data.master_key_initialized ? "已初始化" : "未初始化",
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="mb-2 text-sm text-muted-foreground">{label}</dt>
                <dd className="break-all text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="space-y-3 border-t pt-5">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void check()}
            >
              {busy ? "正在检测…" : "检测数据库连接"}
            </Button>
            <ErrorBox>{error}</ErrorBox>
          </div>
        </div>
      )}
    </AsyncState>
  );
}
