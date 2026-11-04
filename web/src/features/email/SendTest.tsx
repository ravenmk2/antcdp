import { writeOutcomeUnknown } from "@/lib/write-error";
import { useOperationToast } from "@/components/platform/operation-toast";
import {
  OperationStatus,
  operationTone,
} from "@/components/platform/operation-status";
import { useState } from "react";
import {
  type EmailProfile,
  type EmailTemplate,
  type SendLog,
  labels,
  explain,
} from "@/shared/email";
import { request, errorMessage } from "@/lib/api";
import { jsonObject } from "@/lib/preview";
import { useCatalogPages } from "@/lib/use-catalog-pages";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { FormDrawer } from "@/components/platform/form-drawer";
import { ErrorBox, AsyncState } from "@/components/platform/feedback";
import {
  TextControl,
  AreaControl,
  ChoiceControl,
  ValuesGrid,
} from "@/components/platform/form-controls";
import { Button } from "@/components/ui/button";
import { useDate } from "@/lib/date";
export function LogValues({ log: l }: { log: SendLog }) {
  const date = useDate();
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">
        <OperationStatus value={l.status}>
          {labels[l.status] || l.status}
        </OperationStatus>
      </h3>
      <p className="text-sm">{explain(l)}</p>
      <ValuesGrid
        items={[
          ["配置", l.profile_name],
          ["模板", l.template_name || "直接内容"],
          ["收件地址", l.recipient_mask],
          ["操作者", l.actor_name],
          ["提交阶段", l.stage],
          ["开始时间", date(l.started_at)],
          ["完成时间", date(l.finished_at)],
          [
            "附件",
            l.attachment_count + " 个 · " + l.attachment_bytes + " 字节",
          ],
          ["测试编号", l.test_id],
          ["Message-ID", l.message_id || "—"],
          ["诊断状态", l.outdated ? "历史结果" : "当前记录"],
        ]}
      />
    </div>
  );
}
export function attachmentError(files: File[]) {
  return files.length > 5 ||
    files.some((f) => f.size > 5 * 1024 * 1024) ||
    files.reduce((n, f) => n + f.size, 0) > 10 * 1024 * 1024
    ? "最多 5 个附件，单个 5 MiB，合计 10 MiB。"
    : "";
}
export function SendTest({
  initialProfile,
  initialTemplate,
  onClose,
  onCompleted,
}: {
  initialProfile?: string;
  initialTemplate?: string;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const profiles = useCatalogPages<EmailProfile>(
      "/admin/email/profiles?status=enabled",
    ),
    templates = useCatalogPages<EmailTemplate>(
      "/admin/email/templates?status=enabled",
    );
  const [chosen, setChosen] = useState(initialProfile),
    [templateId, setTemplate] = useState(initialTemplate || ""),
    [sender, setSender] = useState<string>(),
    [recipient, setRecipient] = useState(""),
    [subject, setSubject] = useState("测试邮件"),
    [format, setFormat] = useState("text"),
    [body, setBody] = useState("这是一封用于验证邮件配置的测试邮件。"),
    [parameters, setParameters] = useState<string>(),
    [files, setFiles] = useState<File[]>([]),
    [error, setError] = useState(""),
    [result, setResult] = useState<SendLog>();
  const save = useSubmission(),
    errors = useFormErrors();
  const profile = profiles.items?.find(
      (p) => p.id === (chosen || profiles.items?.[0]?.id),
    ),
    template = templates.items?.find((t) => t.id === templateId),
    senderId = sender || profile?.sender_names.find((n) => n.default)?.id || "",
    params = parameters ?? JSON.stringify(template?.sample_data || {}, null, 2);
  const dirty =
    !result &&
    !!(
      recipient ||
      files.length ||
      parameters !== undefined ||
      subject !== "测试邮件" ||
      body !== "这是一封用于验证邮件配置的测试邮件。"
    );
  const notify = useOperationToast();
  const [reviewUrl, setReviewUrl] = useState("");
  async function submit() {
    setError("");
    const invalid: Record<string, string> = {};
    if (!profile) invalid.profile = "请选择启用的 SMTP 配置。";
    if (!senderId) invalid.sender = "请选择发件名称。";
    if (!/^[^\s@]+@[^\s@]+$/.test(recipient.trim()))
      invalid.recipient = "请输入有效的收件地址。";
    let values = {};
    if (templateId) {
      if (!template) invalid.template = "请选择可用模板。";
      try {
        values = jsonObject(params);
      } catch {
        invalid.parameters = "参数必须是有效 JSON 对象。";
      }
    } else {
      if (!subject.trim()) invalid.subject = "请输入主题。";
      if (!body.trim()) invalid.body = "请输入正文。";
    }
    if (!errors.validate(invalid) || !profile || result) return;
    const payload = {
      recipient: recipient.trim(),
      sender_name_id: senderId,
      ...(template
        ? {
            template: {
              id: template.id,
              version: template.version,
              parameters: values,
            },
          }
        : { content: { subject, body_format: format, body } }),
    };
    let requestBody: unknown = payload;
    if (files.length) {
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      files.forEach((f) => form.append("attachments", f));
      requestBody = form;
    }
    await save.submit(
      async () => {
        notify("正在提交测试邮件请求。", "info");
        const r = await request<SendLog>(
          "/admin/email/profiles/" + profile.id + "/test",
          {
            method: "POST",
            etag: '"' + profile.version + '"',
            body: requestBody,
          },
        );
        notify(
          "测试邮件：" + (labels[r.data.status] || "请核对结果"),
          operationTone(r.data.status) ?? "warning",
        );
        if (r.data.status === "unknown")
          setReviewUrl(`/admin/email/send-logs?profile_id=${profile.id}`);
        setResult(r.data);
        setFiles([]);
        onCompleted();
      },
      (e) => {
        if (writeOutcomeUnknown(e)) {
          setError(
            "发送结果待核对，消息可能已提交。请核对发送日志后再决定是否发送。",
          );
          setReviewUrl(`/admin/email/send-logs?profile_id=${profile.id}`);
        } else setError(errorMessage(e));
      },
    );
  }
  return (
    <FormDrawer
      title="发送测试邮件"
      description="确认收件地址、内容与附件后，使用所选 SMTP 配置实际发送。"
      dirty={dirty}
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
              form="test-email"
              disabled={
                save.pending ||
                save.blocked ||
                profiles.loading ||
                templates.loading ||
                !profiles.items?.length
              }
            >
              {save.pending ? "正在提交…" : "发送测试邮件"}
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
            id="test-email"
            ref={errors.formRef}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <fieldset
              disabled={save.pending || save.blocked}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <ChoiceControl
                  label="SMTP 配置"
                  value={profile?.id || ""}
                  onValue={(id) => {
                    setChosen(id);
                    setSender(undefined);
                  }}
                  options={(profiles.items || []).map((p) => [p.id, p.name])}
                  error={errors.fields.profile}
                />
                <ChoiceControl
                  label="发件名称"
                  value={senderId}
                  onValue={setSender}
                  options={(profile?.sender_names || []).map((n) => [
                    n.id,
                    n.name,
                  ])}
                  error={errors.fields.sender}
                />
              </div>
              {!profiles.items?.length && (
                <p role="status">请先创建并启用 SMTP 配置。</p>
              )}
              <TextControl
                required
                label="收件地址"
                type="email"
                value={recipient}
                onValue={setRecipient}
                error={errors.fields.recipient}
              />
              <ChoiceControl
                label="内容来源"
                value={templateId}
                onValue={(id) => {
                  setTemplate(id);
                  setParameters(undefined);
                }}
                options={[
                  ["", "直接填写"],
                  ...(templates.items || []).map(
                    (t) => [t.id, t.name] as const,
                  ),
                ]}
                error={errors.fields.template}
              />
              {templateId ? (
                <AreaControl
                  label="模板参数（JSON）"
                  value={params}
                  onValue={setParameters}
                  rows={6}
                  error={errors.fields.parameters}
                />
              ) : (
                <>
                  <TextControl
                    label="邮件主题"
                    required
                    value={subject}
                    onValue={setSubject}
                    error={errors.fields.subject}
                  />
                  <ChoiceControl
                    label="正文格式"
                    value={format}
                    onValue={setFormat}
                    options={[
                      ["text", "纯文本"],
                      ["html", "HTML"],
                    ]}
                  />
                  <AreaControl
                    label="邮件正文"
                    required
                    rows={5}
                    value={body}
                    onValue={setBody}
                    error={errors.fields.body}
                  />
                </>
              )}
              <label className="block space-y-2 text-sm font-medium">
                <span>附件</span>
                <input
                  className="block w-full rounded-lg border p-2"
                  type="file"
                  multiple
                  onChange={(e) => {
                    const list = Array.from(e.target.files || []),
                      issue = attachmentError(list);
                    setError(issue);
                    setFiles(issue ? [] : list);
                    if (issue) e.target.value = "";
                  }}
                />
                <small className="text-muted-foreground">
                  最多 5 个，单个 5 MiB，合计 10 MiB。
                </small>
              </label>
            </fieldset>
          </form>
        </AsyncState>
      )}
    </FormDrawer>
  );
}
