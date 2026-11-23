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
    }[];
  }>(["project-run-accounts", base], `${base}/run-account-options`);
  const accountOptions = accounts.data?.data.items ?? [];
  return (
    <>
      <Field
        label="运行账号"
        required
        error={attempted && !value ? "请选择项目机器人" : undefined}
        hint={
          accounts.isPending
            ? "正在读取运行账号…"
            : !accounts.error && !accountOptions.length
              ? "暂无可用的项目机器人。"
              : undefined
        }
      >
        <Select value={value} onValueChange={onChange}>
          <option value="">选择项目机器人</option>
          {value && !accountOptions.some((account) => account.id === value) && (
            <option value={value} disabled>
              账号 #{value}（请选择可用的项目机器人）
            </option>
          )}
          {accountOptions.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} ({account.username})
            </option>
          ))}
        </Select>
      </Field>
      <ErrorNotice error={accounts.error} />
    </>
  );
}
