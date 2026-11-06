import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Database, FileClock, Monitor, Settings } from "lucide-react";
import { request } from "@/api/client";
import { Button } from "@/components/button";
import { AsyncBoundary, ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, Select } from "@/components/fields";
import { DescriptionList, PageHeader, Panel } from "@/components/layout";
import { useApiQuery } from "@/hooks/use-api";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useUnsaved } from "@/hooks/use-unsaved";
import type { PublicSettings } from "@/types/auth";

interface SystemSettings extends PublicSettings {
  version: string;
  deployment: { public_url: string };
}
interface SystemInfo {
  version: string;
  data_directory: string;
  database_type: string;
  master_key_initialized: boolean;
}

export function SettingsPage() {
  const [params] = useSearchParams();
  const tab = params.get("tab") ?? "general";
  const settings = useApiQuery<SystemSettings>(
    ["admin-settings"],
    "/admin/settings",
    { enabled: tab === "general" || tab === "access" },
  );
  return (
    <div className="page">
      <PageHeader
        title="系统设置"
        description="维护系统资料、注册与会话策略，查看运行信息。"
      />
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="系统设置分类">
          {[
            { key: "general", label: "基本设置", icon: Settings },
            { key: "access", label: "注册与会话", icon: Settings },
            { key: "system", label: "系统信息", icon: Monitor },
            { key: "maintenance", label: "临时文件", icon: FileClock },
          ].map(({ key, label, icon: Icon }) => (
            <Link
              key={key}
              to={`/admin/settings?tab=${key}`}
              aria-current={tab === key ? "page" : undefined}
            >
              <Icon />
              {label}
            </Link>
          ))}
        </nav>
        <div>
          {tab === "system" ? (
            <SystemInformation />
          ) : tab === "maintenance" ? (
            <Panel
              title="临时文件维护"
              action={
                <Button asChild>
                  <Link to="/admin/maintenance">进入维护工作区</Link>
                </Button>
              }
            >
              <p className="text-sm text-muted">
                预览发布上传产生的无引用暂存文件，复核后手动清理。
              </p>
            </Panel>
          ) : (
            <AsyncBoundary
              loading={settings.isPending}
              error={settings.error}
              onRetry={() => void settings.refetch()}
            >
              {settings.data && (
                <SettingsForm
                  key={`${tab}-${settings.data.etag}`}
                  tab={tab}
                  initial={settings.data.data}
                  etag={settings.data.etag}
                />
              )}
            </AsyncBoundary>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsForm({
  initial,
  etag,
  tab,
}: {
  initial: SystemSettings;
  etag: string;
  tab: string;
}) {
  const [form, setForm] = useState({
    site_name: initial.site_name,
    timezone: initial.timezone,
    registration_enabled: initial.registration_enabled,
    session_ttl_days: initial.session_ttl_days,
  });
  const errors = useFormErrors();
  const submission = useSubmission();
  const queryClient = useQueryClient();
  const original = {
    site_name: initial.site_name,
    timezone: initial.timezone,
    registration_enabled: initial.registration_enabled,
    session_ttl_days: initial.session_ttl_days,
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  useUnsaved(dirty, submission.pending);
  async function save() {
    const fields: Record<string, string> = {};
    if (Array.from(form.site_name.trim()).length > 40)
      fields.site_name = "系统名称最多 40 个字符";
    if (
      !Number.isInteger(form.session_ttl_days) ||
      form.session_ttl_days < 1 ||
      form.session_ttl_days > 30
    )
      fields.session_ttl_days = "会话有效期须为 1–30 天";
    if (!errors.validate(fields)) return;
    await submission.run(
      async () => {
        await request("/admin/settings", {
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
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["admin-settings"] }),
          queryClient.invalidateQueries({ queryKey: ["public-settings"] }),
          queryClient.invalidateQueries({ queryKey: ["admin-overview"] }),
        ]);
      },
      (error) =>
        errors.show(error, [
          "site_name",
          "timezone",
          "registration_enabled",
          "session_ttl_days",
        ]),
    );
  }
  return (
    <Panel title={tab === "general" ? "系统资料" : "注册与会话"}>
      <form
        ref={errors.formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorNotice error={errors.error} />
        <ErrorNotice error={submission.error} />
        {tab === "general" ? (
          <div className="form-grid">
            <Field
              label="系统名称"
              hint="可选，最多 40 个字符"
              error={errors.fields.site_name}
            >
              <Input
                name="site_name"
                value={form.site_name}
                onChange={(event) =>
                  setForm({ ...form, site_name: event.target.value })
                }
              />
            </Field>
            <Field label="系统时区" required error={errors.fields.timezone}>
              <Select
                name="timezone"
                value={form.timezone}
                onValueChange={(value) => setForm({ ...form, timezone: value })}
              >
                {[
                  ...new Set([
                    initial.timezone,
                    "Asia/Shanghai",
                    "UTC",
                    ...Intl.supportedValuesOf("timeZone"),
                  ]),
                ].map((zone) => (
                  <option key={zone}>{zone}</option>
                ))}
              </Select>
            </Field>
            <Field
              label="公开访问地址"
              hint="由部署配置提供"
              className="form-full"
            >
              <Input value={initial.deployment.public_url} readOnly />
            </Field>
          </div>
        ) : (
          <div className="grid gap-5">
            <label className="flex items-start justify-between gap-5 rounded-lg border p-4">
              <span>
                <strong className="block text-sm">允许用户自主注册</strong>
                <small className="mt-1 block text-muted">
                  注册固定为普通用户，无需审批；关闭不影响管理员建号。
                </small>
              </span>
              <input
                type="checkbox"
                className="size-4"
                checked={form.registration_enabled}
                onChange={(event) =>
                  setForm({
                    ...form,
                    registration_enabled: event.target.checked,
                  })
                }
              />
            </label>
            <Field
              label="新会话闲置有效期（天）"
              hint="仅影响新建会话；有效业务访问自动续期"
              error={errors.fields.session_ttl_days}
            >
              <Input
                name="session_ttl_days"
                type="number"
                min={1}
                max={30}
                value={form.session_ttl_days}
                onChange={(event) =>
                  setForm({
                    ...form,
                    session_ttl_days: Number(event.target.value),
                  })
                }
              />
            </Field>
          </div>
        )}
        <div className="form-actions">
          <span className="mr-auto text-xs text-muted">
            {dirty ? "有未保存的修改" : "当前分类已保存"}
          </span>
          <Button
            variant="outline"
            disabled={!dirty}
            onClick={() => setForm(original)}
          >
            撤销修改
          </Button>
          <Button type="submit" disabled={!dirty} pending={submission.pending}>
            保存当前分类
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function SystemInformation() {
  const query = useApiQuery<SystemInfo>(["system-info"], "/admin/system-info");
  const submission = useSubmission();
  const [checked, setChecked] = useState(false);
  return (
    <Panel title="系统信息">
      <AsyncBoundary
        loading={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        {query.data && (
          <>
            <DescriptionList
              items={[
                {
                  label: "运行版本",
                  value: (
                    <span className="mono">{query.data.data.version}</span>
                  ),
                },
                { label: "数据库", value: query.data.data.database_type },
                {
                  label: "数据目录",
                  value: (
                    <span className="mono break-all">
                      {query.data.data.data_directory}
                    </span>
                  ),
                  full: true,
                },
                {
                  label: "主密钥",
                  value: query.data.data.master_key_initialized
                    ? "已初始化"
                    : "未初始化",
                },
              ]}
            />
            <div className="mt-6 border-t pt-5">
              <Button
                variant="outline"
                pending={submission.pending}
                onClick={() =>
                  void submission.run(async () => {
                    await request("/admin/system-info/database-check", {
                      method: "POST",
                      body: {},
                    });
                    setChecked(true);
                  })
                }
              >
                <Database />
                检查当前数据库连接
              </Button>
              {checked && !submission.error && (
                <Notice tone="success" className="mt-3">
                  数据库连接正常。
                </Notice>
              )}
              <ErrorNotice error={submission.error} />
            </div>
          </>
        )}
      </AsyncBoundary>
    </Panel>
  );
}
