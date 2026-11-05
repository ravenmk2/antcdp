import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Check, Database, KeyRound } from "lucide-react";
import { api, isUncertain, resetCSRF, type ApiError } from "@/api/client";
import { Button } from "@/components/button";
import { ErrorNotice, Notice } from "@/components/feedback";
import { Field, Input, Select } from "@/components/fields";
import { WizardSteps } from "@/components/wizard";
import { useFormErrors, useSubmission } from "@/hooks/use-form";
import { useApiQuery } from "@/hooks/use-api";
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
const steps = ["连接数据库", "系统信息", "创始人账号", "完成"];

export function SetupPage({
  publicUrl = location.origin,
}: {
  publicUrl?: string;
}) {
  const setupStatus = useApiQuery<SetupStatus>(["setup"], "/setup/status");
  const resolvedPublicUrl = setupStatus.data?.data.public_url ?? publicUrl;
  const [step, setStep] = useState(0);
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
  const [completed, setCompleted] = useState<{ authenticated: boolean } | null>(
    null,
  );
  const [unknown, setUnknown] = useState(false);
  const [status, setStatus] = useState("");
  const errors = useFormErrors();
  const submission = useSubmission();

  function updateDatabase(key: keyof DatabaseDraft, value: string) {
    setDatabase((current) => ({ ...current, [key]: value }));
    setChecked(false);
    errors.change(key);
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
    errors.clear();
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
    const succeeded = await submission.run(
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
    if (!succeeded) {
      setChecked(false);
      errors.show(
        submission.error,
        Object.keys(database),
        Object.fromEntries(
          Object.keys(database).map((key) => [`database.${key}`, key]),
        ),
      );
    }
  }
  async function next(event: FormEvent) {
    event.preventDefault();
    errors.clear();
    setStatus("");
    if (!validateCurrent()) return;
    if (step === 0 && !checked) {
      setStatus("请先完成数据库连接检查，再继续。");
      return;
    }
    if (step < 2) {
      setStep((current) => current + 1);
      requestAnimationFrame(() =>
        document.getElementById("setup-title")?.focus(),
      );
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
          setCompleted({ authenticated: result.authenticated });
          setStep(3);
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
        <header className="mb-8 flex items-center gap-3 text-lg font-semibold">
          <img src="/logo.svg" alt="" className="size-9 dark:hidden" />
          <img
            src="/logo-inverse.svg"
            alt=""
            className="hidden size-9 dark:block"
          />
          AntCDP
        </header>
        <WizardSteps steps={steps} current={step} />
        <section className="panel mt-6 p-7">
          <h1
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
            <Completion authenticated={completed.authenticated} />
          ) : (
            <form
              ref={errors.formRef}
              noValidate
              onSubmit={(event) => void next(event)}
            >
              <fieldset disabled={submission.pending || unknown}>
                <ErrorNotice error={errors.error} />
                {status && (
                  <Notice
                    tone={status.includes("通过") ? "success" : "warning"}
                    className="mb-4"
                  >
                    {status}
                  </Notice>
                )}
                {unknown && (
                  <Notice tone="warning" title="安装结果未知" className="mb-4">
                    请求可能已经完成。请让维护者核对服务状态；不要重新提交安装。
                  </Notice>
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
                      <Input
                        name="port"
                        type="number"
                        value={database.port}
                        onChange={(event) =>
                          updateDatabase("port", event.target.value)
                        }
                      />
                    </Field>
                    <Field label="数据库名" required error={errors.fields.name}>
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
                    <Field label="传输加密" required>
                      <Select
                        name="tls_mode"
                        value={database.tls_mode}
                        onChange={(event) =>
                          updateDatabase("tls_mode", event.target.value)
                        }
                      >
                        <option value="disabled">不启用 TLS</option>
                        <option value="verify_identity">验证服务器身份</option>
                      </Select>
                    </Field>
                    <div className="form-full flex flex-wrap items-center gap-3">
                      <Button
                        variant="outline"
                        pending={submission.pending}
                        onClick={() => void checkDatabase()}
                      >
                        检查数据库连接
                      </Button>
                      {checked && (
                        <span className="flex items-center gap-1 text-sm text-success">
                          <Check className="size-4" />
                          检查通过
                        </span>
                      )}
                    </div>
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
                          setSite({ ...site, site_name: event.target.value })
                        }
                      />
                    </Field>
                    <Field
                      label="系统时区"
                      required
                      error={errors.fields.timezone}
                    >
                      <Select
                        name="timezone"
                        value={site.timezone}
                        onChange={(event) =>
                          setSite({ ...site, timezone: event.target.value })
                        }
                      >
                        {[
                          ...new Set([
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
                          setFounder({
                            ...founder,
                            username: event.target.value,
                          })
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
                          setFounder({
                            ...founder,
                            display_name: event.target.value,
                          })
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
                          setFounder({
                            ...founder,
                            password: event.target.value,
                          })
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
                          setFounder({
                            ...founder,
                            confirm: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Notice className="form-full">
                      <KeyRound className="size-4" />
                      创始人拥有系统管理权限，请妥善保存密码。
                    </Notice>
                  </div>
                )}
                <div className="form-actions">
                  {step > 0 && (
                    <Button
                      variant="outline"
                      disabled={submission.pending}
                      onClick={() => setStep((current) => current - 1)}
                    >
                      上一步
                    </Button>
                  )}
                  <Button type="submit" pending={submission.pending}>
                    {step === 2 ? "确认并安装" : "继续"}
                  </Button>
                </div>
              </fieldset>
            </form>
          )}
        </section>
        {step === 0 && !completed && (
          <div className="mt-5 flex items-center gap-2 text-xs text-muted">
            <Database className="size-4" />
            连接检查不会创建数据库；最终安装会再次核对空库。
          </div>
        )}
      </div>
    </main>
  );
}

function Completion({ authenticated }: { authenticated: boolean }) {
  const [remaining, setRemaining] = useState(5);
  return (
    <div>
      <Notice tone="success" title="系统已就绪">
        {authenticated
          ? "已为当前浏览器建立创始人会话。"
          : "安装已完成，但当前浏览器未建立会话，请正常登录。"}
      </Notice>
      <p className="my-5 text-sm text-muted">
        {remaining} 秒后可进入系统，也可以立即继续。
      </p>
      <Button
        onClick={() =>
          window.location.replace(authenticated ? "/home" : "/login")
        }
      >
        {authenticated ? "立即进入首页" : "前往登录"}
      </Button>
      <Timer onTick={setRemaining} authenticated={authenticated} />
    </div>
  );
}

import { useEffect } from "react";
function Timer({
  onTick,
  authenticated,
}: {
  onTick: (value: number) => void;
  authenticated: boolean;
}) {
  useEffect(() => {
    let remaining = 5;
    const timer = setInterval(() => {
      remaining -= 1;
      onTick(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        window.location.replace(authenticated ? "/home" : "/login");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [onTick, authenticated]);
  return null;
}
