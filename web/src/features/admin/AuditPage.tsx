import { AuditStatus } from "./AuditStatus";
import { useState, useRef, useEffect } from "react";
import { useLocation, useNavigationType, useSearchParams } from "react-router";
import { adminLoader } from "@/lib/loaders";
import { useQuery } from "@/lib/use-query";
import { useDate } from "@/lib/date";
import { savedPageSize, rememberPageSize } from "@/lib/page-size";
import { actionLabels, type AuditEvent } from "@/shared/audit";
import { AsyncState, ErrorBox } from "@/components/platform/feedback";
import { Pagination } from "@/components/platform/pagination";
import {
  CalendarDays,
  ChevronRight,
  FilterX,
  RefreshCw,
  Search,
} from "lucide-react";
import { Field } from "@/components/platform/field";
import { NativeSelect } from "@/components/platform/native-select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { AuditDetail } from "./AuditDetail";
export const loader = adminLoader;
export function Component() {
  const [params, setParams] = useSearchParams();
  const activeRange = params.has("from") || params.has("to");
  const [datesOpen, setDatesOpen] = useState(activeRange);
  const location = useLocation(),
    navigationType = useNavigationType();
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0),
    [reset, setReset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    composing = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (navigationType === "POP") {
      clearTimeout(timer.current);
      setDatesOpen(activeRange);
      setReset((n) => n + 1);
      setError("");
    }
  }, [navigationType, location.key, activeRange]);
  function schedule(form: HTMLFormElement) {
    clearTimeout(timer.current);
    if (!composing.current) timer.current = setTimeout(() => submit(form), 600);
  }

  const filters = new URLSearchParams();
  for (const key of ["q", "action_prefix", "from", "to"])
    if (params.get(key)) filters.set(key, params.get(key)!);
  const size = [10, 20, 50, 100].includes(Number(params.get("limit")))
    ? Number(params.get("limit"))
    : savedPageSize("audit");
  filters.set("limit", String(size));
  function localDate(value: string | null) {
    if (!value || !Number.isFinite(Date.parse(value))) return "";
    const d = new Date(value);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  }
  function submit(form: HTMLFormElement) {
    clearTimeout(timer.current);
    if (composing.current) return;
    const data = new FormData(form),
      from = String(data.get("from") || ""),
      to = String(data.get("to") || "");
    if (
      (from && !Number.isFinite(Date.parse(from))) ||
      (to && !Number.isFinite(Date.parse(to))) ||
      (from && to && Date.parse(from) >= Date.parse(to))
    ) {
      setError("结束时间必须晚于开始时间，请填写有效时间。");
      return;
    }
    setError("");
    const next = new URLSearchParams({ limit: String(size) });
    for (const key of ["q", "action_prefix"])
      if (data.get(key)) next.set(key, String(data.get(key)).trim());
    if (from) next.set("from", new Date(from).toISOString());
    if (to) next.set("to", new Date(to).toISOString());
    setParams(next);
  }
  return (
    <section aria-label="审计日志" className="space-y-6">
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        <form
          key={reset}
          onChange={(e) => {
            const el = e.target;
            if (el instanceof HTMLInputElement && el.name === "q")
              schedule(e.currentTarget);
            else submit(e.currentTarget);
          }}
          onCompositionStart={() => {
            composing.current = true;
            clearTimeout(timer.current);
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            schedule(e.currentTarget);
          }}
          className="border-b bg-card p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-40 max-w-sm flex-1">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
              />
              <Input
                className="pl-9"
                aria-label="关键词"
                name="q"
                defaultValue={params.get("q") || ""}
                maxLength={64}
                placeholder="搜索事件、操作者或对象"
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.nativeEvent.isComposing ||
                      composing.current ||
                      e.nativeEvent.keyCode === 229)
                  )
                    e.preventDefault();
                }}
              />
            </label>
            <NativeSelect
              aria-label="事件类型"
              className="w-auto max-w-full"
              name="action_prefix"
              defaultValue={params.get("action_prefix") || ""}
            >
              {[
                ["", "全部事件"],
                ["user.", "用户操作"],
                ["settings.", "系统设置"],
                ["auth.", "登录与退出"],
                ["installation.", "系统安装"],
                ["project.", "项目"],
                ["project_", "仓库与产品分支"],
                ["team.", "团队"],
                ["service_", "服务集成"],
                ["remote_host.", "远程主机"],
                ["ssh_credential.", "SSH 凭证"],
                ["email.", "邮件"],
                ["sms.", "短信"],
                ["dingtalk.", "钉钉"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </NativeSelect>
            <Button
              type="button"
              variant="outline"
              aria-expanded={datesOpen}
              aria-controls="audit-dates"
              onClick={() => setDatesOpen(!datesOpen)}
            >
              <CalendarDays />
              {activeRange ? "时间范围 · 已筛选" : "时间范围"}
            </Button>
            <div className="ml-auto flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="清除筛选"
                title="清除筛选"
                onClick={() => {
                  clearTimeout(timer.current);
                  setReset((n) => n + 1);
                  setDatesOpen(false);
                  setError("");
                  setParams({ limit: String(size) });
                }}
              >
                <FilterX />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="刷新"
                title="刷新"
                onClick={() => refresh((n) => n + 1)}
              >
                <RefreshCw />
              </Button>
            </div>
          </div>
          <div id="audit-dates" hidden={!datesOpen}>
            <div className="mt-4 grid max-w-2xl gap-3 border-t pt-4 sm:grid-cols-2">
              {" "}
              <Field label="开始时间（本地）">
                {(props) => (
                  <Input
                    {...props}
                    type="datetime-local"
                    name="from"
                    defaultValue={localDate(params.get("from"))}
                  />
                )}
              </Field>
              <Field label="结束时间（本地）">
                {(props) => (
                  <Input
                    {...props}
                    type="datetime-local"
                    name="to"
                    defaultValue={localDate(params.get("to"))}
                  />
                )}
              </Field>
            </div>
          </div>
        </form>
        <ErrorBox>{error}</ErrorBox>
        <AuditResults
          key={filters.toString() + ":" + revision}
          filters={filters.toString()}
          size={size}
          onSize={(n) => {
            rememberPageSize("audit", n);
            setParams((p) => {
              const next = new URLSearchParams(p);
              next.set("limit", String(n));
              return next;
            });
          }}
        />
      </div>
    </section>
  );
}
export function AuditResults({
  filters,
  size,
  onSize,
}: {
  filters: string;
  size: number;
  onSize: (n: number) => void;
}) {
  const [cursors, setCursors] = useState<string[]>([""]),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState("");
  const params = new URLSearchParams(filters);
  if (cursors[page]) params.set("cursor", cursors[page]!);
  const query = useQuery<AuditEvent[]>(`/admin/audit-events?${params}`),
    date = useDate();
  const next = query.response?.pagination?.next_cursor;
  return (
    <>
      <AsyncState
        loading={query.loading}
        error={query.error}
        empty={!query.data?.length}
        emptyMessage={
          ["q", "action_prefix", "from", "to"].some((k) => params.has(k))
            ? "当前筛选下没有审计记录，请调整筛选条件。"
            : "暂无审计记录。"
        }
        onRetry={query.refresh}
      >
        <Table aria-label="审计日志列表" className="min-w-[680px]">
          <TableHeader>
            <TableRow>
              {["时间", "事件", "操作者", "操作对象", "状态", "详情"].map(
                (h) => (
                  <TableHead key={h}>{h}</TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.data?.map((event) => (
              <TableRow
                key={event.id}
                className="cursor-pointer hover:bg-accent/65 focus-within:bg-accent/65"
                onClick={() => setSelected(event.id)}
              >
                <TableCell className="w-44 text-muted-foreground tabular-nums">
                  {date(event.occurred_at)}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal break-words font-medium">
                  {actionLabels[event.action] || event.action}
                </TableCell>
                <TableCell>
                  <span className="block">{event.actor.display_name}</span>
                  {event.actor.username && (
                    <small className="block text-muted-foreground">
                      @{event.actor.username}
                    </small>
                  )}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal break-all">
                  {event.target.label || "—"}
                </TableCell>
                <TableCell>
                  <AuditStatus event={event} />
                </TableCell>
                <TableCell className="w-16">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={
                      "查看审计详情：" +
                      (actionLabels[event.action] || event.action)
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(event.id);
                    }}
                  >
                    <ChevronRight />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AsyncState>
      {query.data && (
        <Pagination
          page={page + 1}
          size={size}
          pageItems={query.data.length}
          hasNext={Boolean(next)}
          pending={query.loading}
          onChange={(n, newSize) => {
            if (newSize !== size) onSize(newSize);
            else if (n <= page) setPage(n - 1);
            else if (next) {
              setCursors((old) => [...old.slice(0, page + 1), next]);
              setPage(n - 1);
            }
          }}
        />
      )}
      {selected && (
        <AuditDetail id={selected} onClose={() => setSelected("")} />
      )}
    </>
  );
}
