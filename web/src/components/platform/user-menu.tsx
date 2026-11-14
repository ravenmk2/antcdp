import { useSession } from "@/app/auth";
import { appearanceLabels, useTheme, type Appearance } from "@/app/theme";
import { MenuLink } from "@/components/platform/menu-link";
import { type SurfaceArea } from "@/components/platform/surface-context";
import { Avatar } from "@/components/resource-icon";
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Home,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react";
import { Menu as DropdownMenu } from "@base-ui/react/menu";
import { useState } from "react";

const areaEntries = [
  { area: "workspace", to: "/home", label: "工作区", icon: Home },
  { area: "account", to: "/account", label: "个人中心", icon: UserRound },
  { area: "console", to: "/admin", label: "控制台", icon: LayoutDashboard },
] as const;

function FounderCrown() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path
        d="m3 6 4.5 4L12 4l4.5 6L21 6l-2.5 11h-13Z"
        fill="currentColor"
        fillOpacity={0.12}
      />
      <path d="M6 20h12" />
    </svg>
  );
}

function IdentityIcon({
  founder,
  keyboardNavigation,
}: {
  founder: boolean;
  keyboardNavigation: boolean;
}) {
  const label = founder ? "创始人" : "管理员";
  return (
    <TooltipProvider delay={250}>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenu.Item
              aria-label={label}
              data-keyboard={keyboardNavigation}
              className={`inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded-sm outline-none data-[keyboard=true]:focus:ring-2 data-[keyboard=true]:focus:ring-current ${founder ? "text-(--role-founder)" : "text-info"}`}
              closeOnClick={false}
            >
              {founder ? (
                <FounderCrown />
              ) : (
                <ShieldCheck className="size-4" aria-hidden />
              )}
            </DropdownMenu.Item>
          }
        />
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function UserMenu({
  compact,
  onLogout,
  area,
}: {
  compact: boolean;
  onLogout: () => void;
  area: Exclude<SurfaceArea, "public">;
}) {
  const session = useSession();
  const { appearance, setAppearance } = useTheme();
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  return (
    <div className="border-t border-t-border-subtle p-3">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          render={
            <button
              className="sidebar-user flex w-full items-center gap-2 rounded-lg p-2 text-left text-navigation hover:bg-surface-hover"
              aria-label={`用户菜单，${session.user.display_name}`}
              onKeyDownCapture={() => setKeyboardNavigation(true)}
              onPointerDownCapture={() => setKeyboardNavigation(false)}
            >
              <Avatar
                url={session.user.avatar?.url}
                name={session.user.display_name}
              />
              <span
                className="sidebar-label min-w-0 flex-1"
                aria-hidden={compact}
              >
                <strong className="block truncate text-xs">
                  {session.user.display_name}
                </strong>
                <small className="block truncate text-[11px] text-muted">
                  @{session.user.username}
                </small>
              </span>
              <ChevronDown
                className="sidebar-label size-4 text-current"
                aria-hidden
              />
            </button>
          }
        />
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-72 p-2 text-navigation"
          onKeyDownCapture={() => setKeyboardNavigation(true)}
          onPointerMoveCapture={() => setKeyboardNavigation(false)}
          onPointerDownCapture={() => setKeyboardNavigation(false)}
        >
          <div className="mb-2 flex items-center gap-3 rounded-lg bg-surface-subtle p-3">
            <Avatar
              url={session.user.avatar?.url}
              name={session.user.display_name}
              className="size-11"
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <strong className="truncate">
                  {session.user.display_name}
                </strong>
                {session.user.role === "admin" && (
                  <IdentityIcon
                    founder={session.user.is_founder}
                    keyboardNavigation={keyboardNavigation}
                  />
                )}
              </div>
              <small className="text-muted">@{session.user.username}</small>
            </div>
          </div>
          {areaEntries
            .filter(
              (entry) =>
                entry.area !== "console" || session.user.role === "admin",
            )
            .map((entry) => (
              <MenuLink
                key={entry.area}
                to={entry.to}
                icon={entry.icon}
                label={entry.label}
                current={entry.area === area}
                iconClassName="text-current"
                className="text-navigation focus:text-navigation"
              />
            ))}
          <DropdownMenu.SubmenuRoot closeParentOnEsc>
            <DropdownMenu.SubmenuTrigger className="flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden select-none focus:bg-surface-hover data-[open]:bg-surface-hover">
              <Palette className="size-4" aria-hidden />
              <span>外观</span>
              <span className="ml-auto text-xs">
                {appearanceLabels[appearance]}
              </span>
              <ChevronRight className="size-4 text-current" aria-hidden />
            </DropdownMenu.SubmenuTrigger>
            <DropdownMenuSubContent
              sideOffset={6}
              collisionPadding={8}
              className="min-w-40 text-navigation"
            >
              <DropdownMenu.RadioGroup
                value={appearance}
                onValueChange={(value) => setAppearance(value as Appearance)}
                aria-label="外观"
              >
                {(["light", "dark", "system"] as Appearance[]).map((value) => (
                  <DropdownMenu.RadioItem
                    closeOnClick
                    key={value}
                    value={value}
                    className="flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden select-none focus:bg-surface-hover data-[open]:bg-surface-hover"
                  >
                    {value === "light" ? (
                      <Sun className="size-4" aria-hidden />
                    ) : value === "dark" ? (
                      <Moon className="size-4" aria-hidden />
                    ) : (
                      <Monitor className="size-4" aria-hidden />
                    )}
                    {appearanceLabels[value]}
                    <span className="ml-auto size-4">
                      <DropdownMenu.RadioItemIndicator>
                        <Check className="size-4" aria-hidden />
                      </DropdownMenu.RadioItemIndicator>
                    </span>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenu.SubmenuRoot>
          <DropdownMenuSeparator className="my-2" />
          <DropdownMenuItem
            className="flex min-h-9 items-center gap-2 rounded-sm px-2 py-2 text-sm text-navigation outline-hidden select-none focus:bg-surface-hover focus:text-navigation data-[open]:bg-surface-hover"
            onClick={onLogout}
          >
            <LogOut className="size-4 text-current" />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu.Root>
    </div>
  );
}
