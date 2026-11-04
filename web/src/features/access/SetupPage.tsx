import { Database as DatabaseIcon, KeyRound } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { useQuery } from "@/lib/use-query";
import { api, resetCSRF } from "@/lib/api";
import { invalidateIdentity } from "@/app/identity";
import { returnTarget } from "@/lib/navigation";
import { PublicFrame } from "./PublicFrame";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/platform/feedback";
import {
  TextControl,
  ChoiceControl,
} from "@/components/platform/form-controls";
import {
  validatePassword,
  validateSiteName,
  siteNameHelp,
  validateUsername,
  validateDisplayName,
  passwordHelp,
} from "@/shared/validation";
import type { Status, Database, InstallRequest } from "@/shared/setup";
const steps = ["准备安装", "连接数据库", "配置站点", "创建创始人"];
const descriptions = [
  "开始前，请准备好以下两项。",
  "连接检查通过后才能继续。",
  "确认系统名称、访问地址和默认时区。",
  "此账号将成为平台的首个管理员。",
];
const zones = [
  ...new Set(["Asia/Shanghai", "UTC", ...Intl.supportedValuesOf("timeZone")]),
].map((z) => [z, z] as const);
export function Component() {
  const status = useQuery<Status>("/setup/status"),
    state = status.data?.state,
    refresh = status.refresh,
    target = returnTarget(new URL(location.href));
  useEffect(() => {
    if (state === "ready") {
      const id = setTimeout(() => location.replace(target), 5000);
      return () => clearTimeout(id);
    }
    if (state === "initializing") {
      const id = setTimeout(refresh, 2000);
      return () => clearTimeout(id);
    }
  }, [state, target, refresh]);
  if (state === "setup_required")
    return <Wizard publicUrl={status.data!.public_url} onReview={refresh} />;
  const ready = state === "ready",
    init = state === "initializing",
    recovery = state === "recovery_required";
  return (
    <PublicFrame
      installation
      title={
        ready
          ? "系统已就绪"
          : init
            ? "正在初始化系统"
            : recovery
              ? "需要维护者检查"
              : status.loading
                ? "正在读取安装状态"
                : "暂时无法访问系统"
      }
      intro={
        ready
          ? "安装入口已关闭，5 秒后进入工作区。"
          : init
            ? "正在创建系统，页面会自动检查进度。"
            : recovery
              ? "检测到已有安装记录或初始化中断。请联系维护者核对安装锁、数据库和备份。"
              : status.error || "请核对数据库和服务的连接状态。"
      }
    >
      {ready ? (
        <Button asChild>
          <a href={target}>进入工作区</a>
        </Button>
      ) : (
        !init && (
          <Button variant="outline" disabled={status.loading} onClick={refresh}>
            重新检查
          </Button>
        )
      )}
    </PublicFrame>
  );
}
function Wizard({
  publicUrl,
  onReview,
}: {
  publicUrl: string;
  onReview: () => void;
}) {
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    locked = useRef(false),
    [checked, setChecked] = useState(false),
    [uncertain, setUncertain] = useState(false);
  const [database, setDatabase] = useState({
    host: "",
    port: "3306",
    name: "antcdp",
    username: "antcdp",
    password: "",
    tls_mode: "disabled" as Database["tls_mode"],
  });
  const [site, setSite] = useState({
      site_name: "",
      timezone: "Asia/Shanghai",
    }),
    [founder, setFounder] = useState({
      username: "",
      display_name: "",
      password: "",
    }),
    [confirm, setConfirm] = useState("");
  const errors = useFormErrors();
  const db = (
    k: "host" | "port" | "name" | "username" | "password",
    label: string,
  ) => (
    <TextControl
      label={label}
      value={database[k]}
      required={k !== "password"}
      type={k === "password" ? "password" : k === "port" ? "number" : "text"}
      error={errors.fields[k]}
      autoComplete="off"
      onValue={(v) => {
        setDatabase((old) => ({ ...old, [k]: v }));
        setChecked(false);
      }}
    />
  );
  async function next(testOnly = false) {
    if (locked.current || uncertain) return;
    errors.clear();
    if (
      step === 1 &&
      !errors.validate({
        host: database.host.trim() ? "" : "请输入主机地址。",
        port:
          /^\d+$/.test(database.port) &&
          +database.port > 0 &&
          +database.port <= 65535
            ? ""
            : "端口须为 1 至 65535。",
        name: database.name.trim() ? "" : "请输入数据库名。",
        username: database.username.trim() ? "" : "请输入数据库用户。",
      })
    )
      return;
    if (
      step === 2 &&
      !errors.validate({
        site_name: validateSiteName(site.site_name),
      })
    )
      return;
    if (
      step === 3 &&
      !errors.validate({
        username: validateUsername(founder.username),
        display_name: validateDisplayName(founder.display_name),
        password: validatePassword(founder.password),
        confirm: founder.password === confirm ? "" : "两次输入的密码不一致。",
      })
    )
      return;
    locked.current = true;
    setBusy(true);
    const dbBody = { ...database, port: Number(database.port) };
    try {
      if (step === 1 && (!checked || testOnly)) {
        await api("/setup/database-check", dbBody);
        setChecked(true);
      }
      if (step === 3) {
        const body: InstallRequest = { database: dbBody, site, founder };
        await api("/setup/install", body);
        resetCSRF();
        invalidateIdentity();
        onReview();
      } else if (!testOnly) setStep((n) => n + 1);
    } catch (e) {
      errors.show(
        e,
        [
          "host",
          "port",
          "name",
          "username",
          "password",
          "site_name",
          "timezone",
          "display_name",
        ],
        Object.fromEntries(
          ["database", "site", "founder"].flatMap((group) =>
            Object.keys(
              group === "database"
                ? database
                : group === "site"
                  ? site
                  : founder,
            ).map((k) => [group + "." + k, k]),
          ),
        ),
      );
      if (step === 1) setChecked(false);
      if (step === 3) {
        try {
          const current = await api<Status>("/setup/status");
          if (current.state !== "setup_required") {
            resetCSRF();
            onReview();
          }
        } catch {
          setUncertain(true);
        }
      }
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  return (
    <PublicFrame
      installation={{ current: step, steps }}
      title={step === 0 ? "欢迎使用 AntCDP" : steps[step]!}
      intro={descriptions[step]!}
    >
      <form
        noValidate
        ref={errors.formRef}
        onSubmit={(e) => {
          e.preventDefault();
          void next();
        }}
      >
        <fieldset disabled={busy || uncertain} className="space-y-4">
          <ErrorBox>{errors.error}</ErrorBox>
          {step === 0 && (
            <dl className="mb-8 space-y-5">
              {[
                {
                  Icon: DatabaseIcon,
                  title: "空的 MySQL 数据库",
                  help: "准备主机地址、端口和数据库名称。",
                },
                {
                  Icon: KeyRound,
                  title: "数据库专用账号",
                  help: "准备用户名和密码，下一步会检查连接与权限。",
                },
              ].map(({ Icon, title, help }) => (
                <div key={title} className="grid grid-cols-[36px_1fr] gap-x-3">
                  <span
                    aria-hidden
                    className="row-span-2 grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground"
                  >
                    <Icon className="size-[18px]" />
                  </span>
                  <dt className="text-sm font-medium">{title}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">{help}</dd>
                </div>
              ))}
            </dl>
          )}
          {step === 1 && (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
                {db("host", "数据库主机")}
                {db("port", "端口")}
              </div>
              {db("name", "数据库名")}
              {db("username", "数据库用户")}
              {db("password", "数据库密码")}
              <ChoiceControl
                label="传输加密"
                value={database.tls_mode}
                options={[
                  ["disabled", "不启用 TLS"],
                  ["verify_identity", "验证服务器身份"],
                ]}
                onValue={(v) => {
                  setDatabase((old) => ({
                    ...old,
                    tls_mode: v as Database["tls_mode"],
                  }));
                  setChecked(false);
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void next(true)}
              >
                检查连接
              </Button>
              {checked && (
                <p role="status" className="text-sm">
                  数据库连接检查通过
                </p>
              )}
            </>
          )}
          {step === 2 && (
            <>
              <TextControl
                label="系统名称"
                hint={siteNameHelp}
                value={site.site_name}
                error={errors.fields.site_name}
                onValue={(v) => setSite({ ...site, site_name: v })}
              />
              <p className="break-all rounded-lg bg-muted p-3 text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">
                  部署配置的访问地址
                </span>
                {publicUrl}
              </p>
              <ChoiceControl
                label="系统时区"
                value={site.timezone}
                options={zones}
                onValue={(v) => setSite({ ...site, timezone: v })}
              />
            </>
          )}
          {step === 3 && (
            <>
              {(["username", "display_name", "password"] as const).map(
                (key, i) => (
                  <TextControl
                    key={key}
                    required
                    label={["用户名", "显示名称", "密码"][i]!}
                    value={founder[key]}
                    error={errors.fields[key]}
                    type={key === "password" ? "password" : "text"}
                    autoComplete={
                      key === "password"
                        ? "new-password"
                        : key === "username"
                          ? "username"
                          : "nickname"
                    }
                    hint={key === "password" ? passwordHelp : undefined}
                    onValue={(v) => setFounder({ ...founder, [key]: v })}
                  />
                ),
              )}
              <TextControl
                required
                type="password"
                autoComplete="new-password"
                label="确认密码"
                value={confirm}
                error={errors.fields.confirm}
                onValue={setConfirm}
              />
            </>
          )}
          <div className="flex justify-end gap-2 border-t pt-4">
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  errors.clear();
                  setStep((n) => n - 1);
                }}
              >
                上一步
              </Button>
            )}
            <Button type="submit">
              {busy
                ? "处理中…"
                : step === 3
                  ? "安装系统"
                  : step === 0
                    ? "开始安装"
                    : "下一步"}
            </Button>
          </div>
        </fieldset>
      </form>
      {uncertain && (
        <Button variant="outline" onClick={onReview}>
          重新读取安装状态
        </Button>
      )}
    </PublicFrame>
  );
}
