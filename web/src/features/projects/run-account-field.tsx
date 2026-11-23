import { Field, Select } from "@/components/fields";
import { ErrorNotice } from "@/components/feedback";
import { useApiQuery } from "@/hooks/use-api";

export function RunAccountField({
  base,
  value,
  onChange,
  attempted,
}: {
  base: string;
  value: string;
  onChange: (id: string) => void;
  attempted?: boolean;
}) {
  const accounts = useApiQuery<{
    items: {
      id: string;
      name: string;
      username: string;
      account_type: string;
    }[];
  }>(["project-run-accounts", base], `${base}/run-account-options`);
  const accountOptions = accounts.data?.data.items ?? [];
  return (
    <>
      <Field
        label="运行账号"
        required
        error={attempted && !value ? "请选择运行账号" : undefined}
        hint={
          accounts.isPending
            ? "正在读取运行账号…"
            : !accounts.error && !accountOptions.length
              ? "暂无可用的项目运行账号。"
              : undefined
        }
      >
        <Select value={value} onValueChange={onChange}>
          <option value="">选择项目运行账号</option>
          {value && !accountOptions.some((account) => account.id === value) && (
            <option value={value}>账号 #{value}（当前不可用）</option>
          )}
          {accountOptions.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.username}) ·{" "}
              {account.account_type === "robot" ? "机器人" : "成员"}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorNotice error={accounts.error} />
    </>
  );
}
