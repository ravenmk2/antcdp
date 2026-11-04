import { writeOutcomeUnknown } from "@/lib/write-error";
import { useOperationToast } from "@/components/platform/operation-toast";
import {
  OperationStatus,
  operationTone,
} from "@/components/platform/operation-status";
import { useState } from "react";
import {
  type Robot,
  type Diagnostic,
  labels,
  explain,
} from "@/shared/dingtalk";
import { request, errorMessage } from "@/lib/api";
import { useDate } from "@/lib/date";
import { useSubmission } from "@/components/platform/use-submission";
import { useFormErrors } from "@/components/platform/use-form-errors";
import { FormDrawer } from "@/components/platform/form-drawer";
import {
  TextControl,
  ChoiceControl,
  AreaControl,
  ValuesGrid,
} from "@/components/platform/form-controls";
import { ErrorBox } from "@/components/platform/feedback";
import { Button } from "@/components/ui/button";
import { base } from "./Editor";
export function Result({ record: r }: { record: Diagnostic }) {
  const date = useDate();
  return (
    <div className="space-y-3">
      <strong>
        <OperationStatus value={r.outdated ? "outdated" : r.status}>
          {labels[r.status] || r.status}
        </OperationStatus>
      </strong>
      <p className="text-sm">{explain(r)}</p>
      <ValuesGrid
        items={[
          ["诊断时间", date(r.finished_at || r.started_at)],
          ["测试编号", r.test_id],
          ["记录状态", r.outdated ? "配置已变化，结果已过时" : "当前结果"],
        ]}
      />
    </div>
  );
}
export function TestRobot({
  robot,
  onClose,
  onDone,
}: {
  robot: Robot;
  onClose: () => void;
  onDone: () => void;
}) {
  const [subject] = useState(robot),
    [format, setFormat] = useState("text"),
    [title, setTitle] = useState("机器人测试"),
    [body, setBody] = useState("这是一条用于验证机器人配置的测试消息。"),
    [result, setResult] = useState<Diagnostic>(),
    [error, setError] = useState(""),
    save = useSubmission(),
    errors = useFormErrors();
  const notify = useOperationToast();
  const [reviewUrl, setReviewUrl] = useState("");
  async function send() {
    if (result || !robot.enabled) return;
    setError("");
    if (
      !errors.validate({
        title:
          format === "markdown" && (!title.trim() || [...title].length > 100)
            ? "请输入 1–100 个字符的 Markdown 标题。"
            : "",
        body:
          !body.trim() || new TextEncoder().encode(body).length > 16384
            ? "请输入有效正文，最多 16 KiB。"
            : "",
      })
    )
      return;
    await save.submit(
      async () => {
        notify("正在提交机器人测试请求。", "info");
        const r = await request<Diagnostic>(base + "/" + subject.id + "/test", {
          method: "POST",
          etag: '"' + subject.version + '"',
          body: { format, title: format === "markdown" ? title : "", body },
        });
        notify(
          "机器人测试：" + (labels[r.data.status] || "请核对结果"),
          operationTone(r.data.status) ?? "warning",
        );
        if (r.data.status === "unknown")
          setReviewUrl(`/admin/dingtalk/${subject.id}`);
        setResult(r.data);
        onDone();
      },
      (e) => {
        if (writeOutcomeUnknown(e)) {
          setError(
            "发送结果待核对，消息可能已提交。请先核对最近诊断及群消息。",
          );
          setReviewUrl(`/admin/dingtalk/${subject.id}`);
        } else setError(errorMessage(e));
      },
    );
  }
  return (
    <FormDrawer
      size="compact"
      title="发送机器人测试"
      description={subject.name + " · 确认后将向配置的钉钉群发送消息。"}
      dirty={
        !result &&
        (format !== "text" ||
          title !== "机器人测试" ||
          body !== "这是一条用于验证机器人配置的测试消息。")
      }
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
              form="robot-test"
              type="submit"
              disabled={!robot.enabled || save.pending || save.blocked}
            >
              发送测试消息
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
          查看最近诊断（新标签页）
        </a>
      )}
      {result ? (
        <Result record={result} />
      ) : (
        <form
          ref={errors.formRef}
          noValidate
          id="robot-test"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <fieldset
            className="space-y-5"
            disabled={save.pending || save.blocked}
          >
            <ChoiceControl
              label="消息格式"
              value={format}
              onValue={setFormat}
              options={[
                ["text", "文本"],
                ["markdown", "Markdown"],
              ]}
            />
            {format === "markdown" && (
              <TextControl
                label="Markdown 标题"
                required
                value={title}
                onValue={setTitle}
                error={errors.fields.title}
              />
            )}
            <AreaControl
              required
              label="消息正文"
              rows={6}
              value={body}
              onValue={setBody}
              error={errors.fields.body}
            />
            <section className="space-y-2 rounded-lg bg-muted p-4">
              <h3 className="text-xs text-muted-foreground">实际提交的正文</h3>
              <pre className="whitespace-pre-wrap break-words font-sans">
                {subject.keyword + "\n" + body}
              </pre>
            </section>
          </fieldset>
        </form>
      )}
    </FormDrawer>
  );
}
