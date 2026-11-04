import { writeOutcomeUnknown } from "@/lib/write-error";
import { useOperationToast } from "@/components/platform/operation-toast";
import {
  OperationStatus,
  operationTone,
} from "@/components/platform/operation-status";
import { useState } from "react";
import {
  type Template,
  type Profile,
  type Log,
  type Preview,
  labels,
  explain,
} from "@/shared/sms";
import { request, errorMessage } from "@/lib/api";
import { useCatalogPages } from "@/lib/use-catalog-pages";
import { useDate } from "@/lib/date";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { FormDialog } from "@/components/platform/form-dialog";
import { FormDrawer } from "@/components/platform/form-drawer";
import {
  ChoiceControl,
  TextControl,
  ValuesGrid,
} from "@/components/platform/form-controls";
import { ErrorBox, AsyncState } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
export function LogValues({ log: l }: { log: Log }) {
  const date = useDate();
  return (
    <div className="space-y-4">
      <h3 className="font-semibold">
        <OperationStatus value={l.status}>
          {labels[l.status] || l.status}
        </OperationStatus>
      </h3>
      <p>{explain(l)}</p>
      <ValuesGrid
        items={[
          ["短信配置", l.profile_name],
          ["远端模板", l.template_name],
          ["接收号码", l.recipient_mask],
          ["操作者", l.actor_name],
          ["开始时间", date(l.started_at)],
          ["完成时间", date(l.finished_at)],
          ["测试编号", l.test_id],
          ["供应商请求编号", l.provider_request_id || "—"],
          ["供应商消息编号", l.provider_message_id || "—"],
          ["诊断状态", l.outdated ? "历史结果" : "当前记录"],
        ]}
      />
    </div>
  );
}
export function PreviewContent({ value }: { value: Preview }) {
  if (value.body !== undefined)
    return (
      <p className="whitespace-pre-wrap break-words rounded-lg bg-muted p-4">
        {value.body}
      </p>
    );
  return (
    <ValuesGrid
      items={[
        ["签名", value.sign_name],
        ["模板 ID", value.remote_template_id],
        [
          "供应商参数",
          <pre key="map" className="whitespace-pre-wrap break-all">
            {JSON.stringify(value.provider_parameters, null, 2)}
          </pre>,
        ],
      ]}
    />
  );
}
export function initialParameters(t: Template) {
  return Object.fromEntries(
    Object.entries(t.parameter_schema).map(([key, definition]) => [
      key,
      t.sample_data[key] ?? definition.default ?? "",
    ]),
  );
}
function ParameterInputs({
  template: t,
  values,
  onChange,
}: {
  template: Template;
  values: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  return (
    <div className="space-y-3">
      {Object.entries(t.parameter_schema).map(([key, definition]) => (
        <TextControl
          key={key}
          label={key}
          hint={definition.description}
          required={definition.required}
          value={values[key] || ""}
          onValue={(v) => onChange({ ...values, [key]: v })}
        />
      ))}
    </div>
  );
}
export function Simulation({
  template,
  tag,
  onClose,
  onDone,
}: {
  template: Template;
  tag: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [snapshot] = useState({ template, tag }),
    [params, setParams] = useState(() => initialParameters(template)),
    [result, setResult] = useState<string>(),
    [error, setError] = useState(""),
    save = useSubmission();
  return (
    <FormDialog
      open
      title="本地短信模拟"
      description="使用已保存的本地模板渲染正文。模拟不外发短信，也不写入发送日志。"
      dirty={
        result === undefined &&
        JSON.stringify(params) !== JSON.stringify(initialParameters(template))
      }
      pending={save.pending}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button variant="outline" disabled={save.pending} onClick={close}>
            {result === undefined ? "取消" : "关闭"}
          </Button>
          {result === undefined && (
            <Button
              disabled={save.pending || save.blocked}
              onClick={() => {
                setError("");
                void save.submit(
                  async () => {
                    const r = await request<{ body: string }>(
                      "/admin/sms/templates/" +
                        snapshot.template.id +
                        "/simulate",
                      {
                        method: "POST",
                        etag: snapshot.tag,
                        body: { parameters: params },
                      },
                    );
                    setResult(r.data.body);
                    onDone();
                  },
                  (e) => setError(errorMessage(e)),
                );
              }}
            >
              运行模拟
            </Button>
          )}
        </>
      )}
    >
      <ErrorBox>{error}</ErrorBox>
      {result !== undefined ? (
        <>
          <p role="status">模拟已完成，未发送短信。</p>
          <PreviewContent value={{ body: result }} />
        </>
      ) : (
        <ParameterInputs
          template={snapshot.template}
          values={params}
          onChange={setParams}
        />
      )}
    </FormDialog>
  );
}
export function SendTest({
  profileId,
  initial,
  onClose,
  onDone,
}: {
  profileId?: string;
  initial?: Template;
  onClose: () => void;
  onDone: () => void;
}) {
  const profiles = useCatalogPages<Profile>(
      "/admin/sms/profiles?status=enabled",
    ),
    templates = useCatalogPages<Template>(
      "/admin/sms/templates?status=enabled",
    );
  const [pid, setPid] = useState(profileId || initial?.profile_id || ""),
    [tid, setTid] = useState(initial?.id || ""),
    [values, setValues] = useState<Record<string, string>>(),
    [phone, setPhone] = useState(""),
    [result, setResult] = useState<Log>(),
    [error, setError] = useState(""),
    save = useSubmission(),
    errors = useFormErrors();
  const p = profiles.items?.find(
      (r) => r.id === (pid || profiles.items?.[0]?.id),
    ),
    options =
      templates.items?.filter(
        (t) => t.mode === "remote" && t.profile_id === p?.id,
      ) || [],
    t = options.find((t) => t.id === (tid || options[0]?.id)),
    params = values || (t ? initialParameters(t) : {});
  const notify = useOperationToast();
  const [reviewUrl, setReviewUrl] = useState("");
  async function send() {
    if (!p || !t || result) return;
    setError("");
    if (
      !errors.validate({
        recipient: /^1[3-9]\d{9}$/.test(phone.trim())
          ? ""
          : "请输入 11 位中国大陆手机号。",
      })
    )
      return;
    await save.submit(
      async () => {
        notify("正在提交测试短信请求。", "info");
        const r = await request<Log>("/admin/sms/profiles/" + p.id + "/test", {
          method: "POST",
          etag: '"' + p.version + '"',
          body: {
            recipient: phone.trim(),
            template: { id: t.id, version: t.version, parameters: params },
          },
        });
        notify(
          "测试短信：" + (labels[r.data.status] || "请核对结果"),
          operationTone(r.data.status) ?? "warning",
        );
        if (r.data.status === "unknown")
          setReviewUrl(`/admin/sms/send-logs?profile_id=${p.id}`);
        setResult(r.data);
        onDone();
      },
      (e) => {
        if (writeOutcomeUnknown(e)) {
          setError(
            "发送结果待核对，消息可能已提交。请核对发送日志后再决定是否发送。",
          );
          setReviewUrl(`/admin/sms/send-logs?profile_id=${p.id}`);
        } else setError(errorMessage(e));
      },
    );
  }
  return (
    <FormDrawer
      title="发送测试短信"
      description="实际发送使用所选配置绑定的远端模板。"
      dirty={!result && !!(phone || values)}
      pending={save.pending}
      onClose={onClose}
      footer={(close) => (
        <>
          <Button
            variant="outline"
            disabled={save.pending}
            onClick={() => close()}
          >
            {result ? "关闭" : "取消"}
          </Button>
          {!result && (
            <Button
              type="submit"
              form="sms-send"
              disabled={!p || !t || save.pending || save.blocked}
            >
              发送测试短信
            </Button>
          )}
        </>
      )}
    >
      <ErrorBox tone={reviewUrl ? "warning" : "danger"}>{error}</ErrorBox>
      {reviewUrl && (
        <a
          className="inline-block underline"
          href={reviewUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          查看发送日志（新标签页）
        </a>
      )}
      {result ? (
        <LogValues log={result} />
      ) : (
        <AsyncState
          loading={profiles.loading || templates.loading}
          error={profiles.error || templates.error}
          onRetry={() => {
            profiles.refresh();
            templates.refresh();
          }}
        >
          <form
            ref={errors.formRef}
            id="sms-send"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <fieldset
              disabled={save.pending || save.blocked}
              className="space-y-4"
            >
              <ChoiceControl
                label="短信配置"
                value={p?.id || ""}
                onValue={(v) => {
                  setPid(v);
                  setTid("");
                  setValues(undefined);
                }}
                options={(profiles.items || []).map((p) => [p.id, p.name])}
              />
              <ChoiceControl
                label="远端模板"
                value={t?.id || ""}
                onValue={(v) => {
                  setTid(v);
                  setValues(undefined);
                }}
                options={options.map((t) => [t.id, t.name])}
              />
              {!t && <p role="status">请先为此配置创建并启用远端模板。</p>}
              <TextControl
                required
                label="接收号码"
                type="tel"
                value={phone}
                error={errors.fields.recipient}
                onValue={setPhone}
              />
              {t && (
                <ParameterInputs
                  template={t}
                  values={params}
                  onChange={setValues}
                />
              )}
            </fieldset>
          </form>
        </AsyncState>
      )}
    </FormDrawer>
  );
}
