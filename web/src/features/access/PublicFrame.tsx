import { Folder, Code2, Bot, Check, Monitor, Sun, Moon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useAppearance } from "@/app/appearance";
import { NativeSelect } from "@/components/platform/native-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
export function PublicFrame({
  title,
  site = "AntCDP",
  intro,
  children,
  installation,
  signIn = false,
}: {
  title: string;
  site?: string;
  intro: string;
  children: ReactNode;
  installation?: true | { steps: readonly string[]; current: number };
  signIn?: boolean;
}) {
  const { appearance, setAppearance } = useAppearance();
  useEffect(() => {
    document.title = site ? title + " · " + site : "AntCDP";
  }, [title, site]);
  const heading = useRef<HTMLHeadingElement>(null);
  const step =
    typeof installation === "object" ? installation.current : undefined;
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step]);
  const brand = (
    <div className="flex min-w-0 items-center gap-3">
      <img className="size-9 dark:hidden" src={"/logo.svg"} alt="" />
      <img
        className="hidden size-9 dark:block"
        src={"/logo-inverse.svg"}
        alt=""
      />
      <span className="text-lg font-semibold tracking-tight">AntCDP</span>
      {!signIn && site && site !== "AntCDP" && (
        <span className="min-w-0 truncate border-l pl-3 text-sm text-muted-foreground">
          {site}
        </span>
      )}
    </div>
  );
  const theme = (
    <NativeSelect
      aria-label="外观"
      value={appearance}
      onChange={(e) => setAppearance(e.target.value)}
      className="ml-auto w-auto shrink-0 bg-transparent text-xs"
    >
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </NativeSelect>
  );
  if (installation) {
    const progress = installation === true ? undefined : installation;
    const modes = [
      { value: "system", label: "跟随系统", Icon: Monitor },
      { value: "light", label: "浅色", Icon: Sun },
      { value: "dark", label: "深色", Icon: Moon },
    ] as const;
    const mode = modes.find((m) => m.value === appearance) ?? modes[0];
    return (
      <main className="min-h-dvh bg-background px-4 py-5 sm:px-8 sm:py-8">
        <header className="mx-auto flex max-w-5xl items-center gap-3">
          {brand}
          <span className="border-l pl-3 text-sm text-muted-foreground">
            安装向导
          </span>
          <div className="ml-auto">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground"
                  title={"外观 · " + mode.label}
                  aria-label={"选择外观，当前" + mode.label}
                >
                  <mode.Icon className="size-4" strokeWidth={1.5} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={appearance}
                  onValueChange={setAppearance}
                >
                  {modes.map(({ value, label, Icon }) => (
                    <DropdownMenuRadioItem value={value} key={value}>
                      <Icon />
                      {label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div
          className={
            "mx-auto mt-8 overflow-hidden rounded-2xl border bg-card shadow-sm sm:mt-[8vh] " +
            (progress
              ? "grid max-w-[920px] md:grid-cols-[220px_minmax(0,1fr)]"
              : "max-w-md")
          }
        >
          {progress && (
            <aside
              aria-label="安装进度"
              className="border-b bg-muted/70 px-5 py-4 md:border-r md:border-b-0 md:p-7"
            >
              <div className="mb-4 flex items-baseline justify-between md:mb-8">
                <h2 className="text-sm font-semibold">安装步骤</h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {progress.current + 1} / {progress.steps.length}
                </span>
              </div>
              <ol className="flex gap-2 md:flex-col md:gap-0">
                {progress.steps.map((label, i) => (
                  <li
                    key={label}
                    aria-current={i === progress.current ? "step" : undefined}
                    className="relative flex min-w-0 flex-1 items-center gap-3 md:min-h-16"
                  >
                    <span
                      aria-hidden
                      className={
                        "block h-1 w-full rounded-full md:hidden " +
                        (i <= progress.current
                          ? "bg-foreground/75"
                          : "bg-border")
                      }
                    />
                    {i < progress.steps.length - 1 && (
                      <span
                        aria-hidden
                        className="absolute top-1/2 left-[14px] hidden h-full w-px bg-border md:block"
                      />
                    )}
                    <span
                      aria-hidden
                      className={
                        "relative hidden size-[29px] shrink-0 place-items-center rounded-full border text-xs tabular-nums md:grid " +
                        (i === progress.current
                          ? "border-primary bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground")
                      }
                    >
                      {i < progress.current ? (
                        <Check className="size-3.5" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={
                        "sr-only md:not-sr-only md:text-sm " +
                        (i === progress.current
                          ? "font-semibold"
                          : "text-muted-foreground")
                      }
                    >
                      {label}
                    </span>
                  </li>
                ))}
              </ol>
            </aside>
          )}
          <section className="min-w-0 px-6 py-7 sm:p-10">
            <h1
              ref={heading}
              tabIndex={-1}
              className="text-2xl font-semibold tracking-tight sm:text-[28px]"
            >
              {title}
            </h1>
            <p className="mt-2 mb-7 text-sm leading-relaxed text-muted-foreground">
              {intro}
            </p>
            {children}
          </section>
        </div>
      </main>
    );
  }
  if (signIn)
    return (
      <main className="relative grid min-h-dvh place-items-center bg-background px-4 pt-20 pb-8 sm:px-6">
        <div className="absolute right-5 top-4 sm:right-8">{theme}</div>
        <div className="grid w-full max-w-[1000px] overflow-hidden rounded-[18px] border bg-card shadow-[0_24px_80px_#24231e12] md:min-h-[640px] md:grid-cols-[42%_58%]">
          <aside className="relative overflow-hidden px-6 pt-6 md:bg-[#eae8df] md:p-9 md:dark:bg-[#25281f]">
            {brand}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-[20%] bottom-[10%] hidden items-center justify-center md:flex"
            >
              <svg
                className="w-full text-foreground/20"
                viewBox="0 0 440 440"
                fill="none"
              >
                <circle cx="220" cy="220" r="150" stroke="currentColor" />
                <circle cx="220" cy="220" r="100" stroke="currentColor" />
                <path
                  d="M135 123C215 123 328 180 328 220S260 330 170 330"
                  stroke="currentColor"
                  strokeDasharray="4 7"
                />
              </svg>
              {(
                [
                  [Folder, "left-[18%] top-[20%] -rotate-6"],
                  [Code2, "right-[13%] top-[41%] rotate-6"],
                  [Bot, "left-[29%] bottom-[12%] -rotate-3"],
                ] as const
              ).map(([Icon, position]) => {
                return (
                  <span
                    key={position}
                    className={
                      "absolute grid size-[72px] place-items-center rounded-2xl border bg-card text-muted-foreground shadow-sm " +
                      position
                    }
                  >
                    <Icon className="size-7" />
                  </span>
                );
              })}
            </div>
          </aside>
          <section className="flex min-w-0 items-center justify-center px-6 py-8 md:px-12 md:py-12">
            <div className="w-full max-w-[352px]">
              <h1 className="mb-7 text-[28px] font-semibold tracking-tight">
                {title}
              </h1>
              {children}
            </div>
          </section>
        </div>
      </main>
    );
  return (
    <main className="min-h-dvh bg-muted/35 px-4 py-7 sm:px-8 sm:py-12">
      <header className="mx-auto flex max-w-5xl items-center gap-3">
        {brand}
        {theme}
      </header>
      <section className="mx-auto mt-9 max-w-md rounded-2xl border bg-card px-5 py-7 shadow-sm sm:mt-[8vh] sm:p-9">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mb-6 mt-2 text-sm leading-relaxed text-muted-foreground">
          {intro}
        </p>
        {children}
      </section>
    </main>
  );
}
