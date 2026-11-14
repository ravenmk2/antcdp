import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { api, isUncertain, resetCSRF, type ApiError } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import {
  Field,
  Input,
  NumberInput,
  PopupSelect,
  SearchableSelect,
} from "@/components/fields";
import { WizardSteps } from "@/components/wizard";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useApiQuery } from "@/hooks/use-api";
import { useSetupCompletion } from "@/hooks/use-setup-completion";
import type { SetupStatus } from "@/types/auth";
import {
  displayNameSchema,
  passwordSchema,
  usernameSchema,
} from "@/domain/validation";

const databaseSchema = z.object({
  host: z.string().trim().min(1, "请输入数据库主机"),
  port: z
    .string()
    .regex(/^\d+$/, "端口须为数字")
    .refine(
      (value) => Number(value) >= 1 && Number(value) <= 65535,
      "端口范围为 1–65535",
    ),
  name: z.string().trim().min(1, "请输入数据库名"),
  username: z.string().trim().min(1, "请输入数据库用户"),
  password: z.string(),
  tls_mode: z.enum(["disabled", "verify_identity"]),
});
const founderSchema = z
  .object({
    username: usernameSchema,
    display_name: displayNameSchema,
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });

type DatabaseDraft = z.infer<typeof databaseSchema>;
type FounderDraft = z.infer<typeof founderSchema>;
interface InstallationSummary {
  authenticated: boolean;
  siteName: string;
  publicUrl: string;
  timezone: string;
  username: string;
  displayName: string;
  databaseName: string;
}
const steps = ["连接数据库", "系统信息", "创始人账号", "完成"];
const timezones = [
  ...new Set(["Asia/Shanghai", "UTC", ...Intl.supportedValuesOf("timeZone")]),
];

export function SetupPage({
  publicUrl = location.origin,
}: {
  publicUrl?: string;
}) {
  const holdCompletion = useSetupCompletion();
  const setupStatus = useApiQuery<SetupStatus>(["setup"], "/setup/status");
  const resolvedPublicUrl = setupStatus.data?.data.public_url ?? publicUrl;
  const [step, setStep] = useState(0);
  const title = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useLayoutEffect(() => {
    if (previousStep.current !== step) title.current?.focus();
    previousStep.current = step;
  }, [step]);
  const [database, setDatabase] = useState<DatabaseDraft>({
    host: "",
    port: "3306",
    name: "antcdp",
    username: "antcdp",
    password: "",
    tls_mode: "disabled",
  });
  const [site, setSite] = useState({
    site_name: "",
    timezone: "Asia/Shanghai",
  });
  const [founder, setFounder] = useState<FounderDraft>({
    username: "",
    display_name: "",
    password: "",
    confirm: "",
  });
  const [checked, setChecked] = useState(false);
  const [completed, setCompleted] = useState<InstallationSummary | null>(null);
  const [unknown, setUnknown] = useState(false);
  const [status, setStatus] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();

  function updateDatabase(key: keyof DatabaseDraft, value: string) {
    setDatabase((current) => ({ ...current, [key]: value }));
    setChecked(false);
    setStatus("");
    errors.setError("");
    errors.change(key);
  }
  function updateSite(key: keyof typeof site, value: string) {
    setSite((current) => ({ ...current, [key]: value }));
    errors.change(key);
    errors.setError("");
  }
  function updateFounder(key: keyof FounderDraft, value: string) {
    setFounder((current) => ({ ...current, [key]: value }));
    errors.change(key);
    if (key === "password") errors.change("confirm");
    errors.setError("");
  }
  function changeStep(nextStep: number) {
    errors.clear();
    setStatus("");
    setStep(nextStep);
  }
  function validateCurrent() {
    if (step === 0) {
      const result = databaseSchema.safeParse(database);
      if (!result.success)
        return errors.validate(
          Object.fromEntries(
            result.error.issues.map((issue) => [
              String(issue.path[0]),
              issue.message,
            ]),
          ),
        );
    }
    if (step === 1 && Array.from(site.site_name.trim()).length > 40)
      return errors.validate({ site_name: "系统名称最多 40 个字符" });
    if (step === 2) {
      const result = founderSchema.safeParse(founder);
      if (!result.success)
        return errors.validate(
          Object.fromEntries(
            result.error.issues.map((issue) => [
              String(issue.path[0]),
              issue.message,
            ]),
          ),
        );
    }
    return true;
  }
  async function checkDatabase() {
    if (submission.pending || unknown) return;
    errors.clear();
    setStatus("");
    setChecked(false);
    const result = databaseSchema.safeParse(database);
    if (!result.success) {
      errors.validate(
        Object.fromEntries(
          result.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }
    await submission.run(
      async () => {
        await api("/setup/database-check", {
          ...database,
          port: Number(database.port),
        });
        setChecked(true);
        setStatus("数据库连接、版本与空库检查已通过。");
      },
      (error) =>
        errors.show(
          error,
          Object.keys(database),
          Object.fromEntries(
            Object.keys(database).map((key) => [`database.${key}`, key]),
          ),
        ),
    );
  }
  async function next(event: FormEvent) {
    event.preventDefault();
    if (submission.pending || unknown) return;
    errors.clear();
    setStatus("");
    if (!validateCurrent()) return;
    if (step === 0 && !checked) {
      setStatus("请先完成数据库连接检查，再继续。");
      return;
    }
    if (step < 2) {
      changeStep(step + 1);
      return;
    }
    await submission.run(
      async () => {
        try {
          const result = await api<{ authenticated: boolean }>(
            "/setup/install",
            {
              database: { ...database, port: Number(database.port) },
              site,
              founder: {
                username: founder.username,
                display_name: founder.display_name.trim(),
                password: founder.password,
              },
            },
          );
          resetCSRF();
          setCompleted({
            authenticated: result.authenticated,
            siteName: site.site_name.trim() || "AntCDP",
            publicUrl: resolvedPublicUrl,
            timezone: site.timezone,
            username: founder.username,
            displayName: founder.display_name.trim(),
            databaseName: database.name.trim(),
          });
          setDatabase((current) => ({ ...current, password: "" }));
          setFounder((current) => ({ ...current, password: "", confirm: "" }));
          holdCompletion?.();
          changeStep(3);
        } catch (error) {
          if (isUncertain(error)) setUnknown(true);
          try {
            const current = await api<SetupStatus>("/setup/status");
            if (current.state !== "setup_required") {
              setUnknown(false);
              setStatus("安装状态已变化，请重新读取当前状态，不要重复提交。");
            }
          } catch {
            setUnknown(true);
          }
          throw error as ApiError;
        }
      },
      (error) =>
        errors.show(
          error,
          [
            ...Object.keys(database),
            ...Object.keys(founder),
            "site_name",
            "timezone",
          ],
          {
            ...Object.fromEntries(
              Object.keys(database).map((key) => [`database.${key}`, key]),
            ),
            ...Object.fromEntries(
              Object.keys(founder).map((key) => [`founder.${key}`, key]),
            ),
            "site.site_name": "site_name",
            "site.timezone": "timezone",
          },
        ),
    );
  }
  return (
    <main className="setup-page">
      <div className="setup-shell">
        <section className="panel setup-panel">
          <header className="setup-panel-header">
            <div className="flex shrink-0 items-center gap-2.5 text-lg font-semibold">
              <img src="/logo.svg" alt="" className="size-8 dark:hidden" />
              <img
                src="/logo-inverse.svg"
                alt=""
                className="hidden size-8 dark:block"
              />
              AntCDP
            </div>
            <WizardSteps steps={steps} current={step} />
          </header>
          <div className="setup-panel-body">
            <h1
              ref={title}
              id="setup-title"
              tabIndex={-1}
              className="mb-2 text-[25px] font-semibold"
            >
              {completed ? "安装完成" : steps[step]}
            </h1>
            <p className="mb-6 text-sm text-muted">
              {completed
                ? "系统已完成初始化，可以开始使用。"
                : step === 0
                  ? "准备专用的空 MySQL 数据库，并通过检查后继续。"
                  : step === 1
                    ? "设置系统名称和默认时区。"
                    : "创建首个系统管理员账号。"}
            </p>
            {completed ? (
              <Completion summary={completed} />
            ) : (
              <form
                ref={errors.formRef}
                noValidate
                onSubmit={(event) => void next(event)}
              >
                <fieldset disabled={submission.pending || unknown}>
                  {(errors.error || status || unknown) && (
                    <div className="mb-5 grid gap-3">
                      <ErrorNotice error={errors.error} />
                      {status && (
                        <Notice
                          tone={status.includes("通过") ? "success" : "warning"}
                        >
                          {status}
                        </Notice>
                      )}
                      {unknown && (
                        <Notice tone="warning" title="安装结果未知">
                          请求可能已经完成。请让维护者核对服务状态；不要重新提交安装。
                        </Notice>
                      )}
                    </div>
                  )}
                  {step === 0 && (
                    <div className="form-grid">
                      <Field
                        label="数据库主机"
                        required
                        error={errors.fields.host}
                      >
                        <Input
                          name="host"
                          autoComplete="off"
                          value={database.host}
                          onChange={(event) =>
                            updateDatabase("host", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="端口" required error={errors.fields.port}>
                        <NumberInput
                          name="port"
                          label="端口"
                          disabled={submission.pending || unknown}
                          min={1}
                          max={65535}
                          value={database.port}
                          onValueChange={(value) =>
                            updateDatabase("port", value)
                          }
                        />
                      </Field>
                      <Field
                        label="数据库名"
                        required
                        error={errors.fields.name}
                      >
                        <Input
                          name="name"
                          autoComplete="off"
                          value={database.name}
                          onChange={(event) =>
                            updateDatabase("name", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="数据库用户"
                        required
                        error={errors.fields.username}
                      >
                        <Input
                          name="username"
                          autoComplete="off"
                          value={database.username}
                          onChange={(event) =>
                            updateDatabase("username", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="数据库密码" error={errors.fields.password}>
                        <Input
                          name="password"
                          type="password"
                          autoComplete="off"
                          value={database.password}
                          onChange={(event) =>
                            updateDatabase("password", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="传输加密"
                        required
                        error={errors.fields.tls_mode}
                      >
                        <PopupSelect
                          name="tls_mode"
                          value={database.tls_mode}
                          disabled={submission.pending || unknown}
                          onValueChange={(value) =>
                            updateDatabase("tls_mode", value)
                          }
                          options={[
                            { value: "disabled", label: "不启用 TLS" },
                            {
                              value: "verify_identity",
                              label: "验证服务器身份",
                            },
                          ]}
                        />
                      </Field>
                    </div>
                  )}
                  {step === 1 && (
                    <div className="form-grid">
                      <Field
                        label="系统名称"
                        hint="可选，最多 40 个字符"
                        error={errors.fields.site_name}
                      >
                        <Input
                          name="site_name"
                          value={site.site_name}
                          onChange={(event) =>
                            updateSite("site_name", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="系统时区"
                        required
                        error={errors.fields.timezone}
                      >
                        <SearchableSelect
                          name="timezone"
                          searchLabel="搜索时区"
                          emptyLabel="没有匹配的时区"
                          value={site.timezone}
                          disabled={submission.pending || unknown}
                          onValueChange={(value) =>
                            updateSite("timezone", value)
                          }
                          options={timezones}
                        />
                      </Field>
                      <Field
                        label="公开访问地址"
                        hint="由部署配置提供"
                        className="form-full"
                      >
                        <Input value={resolvedPublicUrl} readOnly />
                      </Field>
                    </div>
                  )}
                  {step === 2 && (
                    <div className="form-grid">
                      <Field
                        label="用户名"
                        required
                        hint="3–30 位小写字母、数字、_ 或 -"
                        error={errors.fields.username}
                      >
                        <Input
                          name="username"
                          autoComplete="username"
                          value={founder.username}
                          onChange={(event) =>
                            updateFounder("username", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="显示名称"
                        required
                        error={errors.fields.display_name}
                      >
                        <Input
                          name="display_name"
                          autoComplete="nickname"
                          value={founder.display_name}
                          onChange={(event) =>
                            updateFounder("display_name", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="密码"
                        required
                        hint="至少 8 个字符，且不超过 72 个 UTF-8 字节"
                        error={errors.fields.password}
                      >
                        <Input
                          name="password"
                          type="password"
                          autoComplete="new-password"
                          value={founder.password}
                          onChange={(event) =>
                            updateFounder("password", event.target.value)
                          }
                        />
                      </Field>
                      <Field
                        label="确认密码"
                        required
                        error={errors.fields.confirm}
                      >
                        <Input
                          name="confirm"
                          type="password"
                          autoComplete="new-password"
                          value={founder.confirm}
                          onChange={(event) =>
                            updateFounder("confirm", event.target.value)
                          }
                        />
                      </Field>
                      <Notice className="form-full">
                        创始人拥有系统管理权限，请妥善保存密码。
                      </Notice>
                    </div>
                  )}
                  <div className="form-actions">
                    {step > 0 && (
                      <Button
                        variant="outline"
                        className="mr-auto"
                        disabled={submission.pending}
                        onClick={() => changeStep(step - 1)}
                      >
                        上一步
                      </Button>
                    )}
                    {step === 0 && (
                      <Button
                        variant="outline"
                        pending={submission.pending}
                        onClick={() => void checkDatabase()}
                      >
                        检查连接
                      </Button>
                    )}
                    <Button
                      type="submit"
                      pending={step === 2 && submission.pending}
                    >
                      {step === 2 ? "确认并安装" : "下一步"}
                    </Button>
                  </div>
                </fieldset>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Completion({ summary }: { summary: InstallationSummary }) {
  const details = [
    ["系统名称", summary.siteName],
    ["系统时区", summary.timezone],
    ["创始人账号", summary.username],
    ["显示名称", summary.displayName],
    ["数据库名", summary.databaseName],
    ["公开访问地址", summary.publicUrl],
  ];
  return (
    <div>
      <Notice tone="success" title="系统已就绪">
        {summary.authenticated
          ? "已为当前浏览器建立创始人会话。"
          : "安装已完成，但当前浏览器未建立会话，请正常登录。"}
      </Notice>
      <dl className="my-6 grid grid-cols-2 gap-x-6 gap-y-5 rounded-lg border bg-surface-subtle p-5">
        {details.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="mb-1.5 text-xs text-muted">{label}</dt>
            <dd className="break-words text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="form-actions">
        <Button
          render={
            <a
              href={
                summary.authenticated
                  ? "/admin/cloud-computers/settings"
                  : "/login?return_to=%2Fadmin%2Fcloud-computers%2Fsettings"
              }
            >
              配置沙箱连接（可稍后）
            </a>
          }
          nativeButton={false}
          role="link"
          variant="outline"
        />
        <Button
          render={
            <a href={summary.authenticated ? "/home" : "/login"}>进入系统</a>
          }
          nativeButton={false}
          role="link"
        />
      </div>
    </div>
  );
}
