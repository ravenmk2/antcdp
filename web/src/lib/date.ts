import { useIdentity } from "@/app/identity";
export function useDate() {
  const { settings } = useIdentity();
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: settings.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (value: string | null | undefined) =>
    value && Number.isFinite(Date.parse(value))
      ? formatter.format(new Date(value))
      : "尚无记录";
}
