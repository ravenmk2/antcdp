import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/platform/field";
import { ErrorBox } from "@/components/platform/feedback";
import { FormDialog } from "@/components/platform/form-dialog";
export function Component() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">组件状态</h1>
      <div className="flex flex-wrap gap-3">
        {(
          ["default", "secondary", "outline", "ghost", "destructive"] as const
        ).map((variant) => (
          <Button variant={variant} key={variant}>
            {variant}
          </Button>
        ))}
        <Button disabled>不可操作</Button>
      </div>
      <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
        <Field label="名称" hint="支持中文与较长的资源名称">
          {(props) => <Input {...props} placeholder="输入名称" />}
        </Field>
        <Field label="字段错误" error="名称已被使用，请选择其他名称" required>
          {(props) => <Input {...props} defaultValue="示例" />}
        </Field>
        <Field label="只读">
          {(props) => <Input {...props} readOnly value="不可更改的编码" />}
        </Field>
        <Field label="禁用">
          {(props) => <Input {...props} disabled value="暂不可用" />}
        </Field>
      </div>
      <ErrorBox>无法完成请求。请检查网络后重试。</ErrorBox>
      <Button onClick={() => setOpen(true)}>打开表单</Button>
      <FormDialog
        open={open}
        title="资料编辑"
        dirty={!!value}
        onClose={() => setOpen(false)}
        footer={(close) => (
          <>
            <Button variant="outline" onClick={close}>
              取消
            </Button>
            <Button
              onClick={() => {
                setValue("");
                setOpen(false);
              }}
            >
              保存示例
            </Button>
          </>
        )}
      >
        <Field label="名称">
          {(props) => (
            <Input
              {...props}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
        </Field>
      </FormDialog>
    </div>
  );
}
