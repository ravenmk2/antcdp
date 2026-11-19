import { useAuth, useSession } from "@/app/auth";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { ApiResponse } from "@/api/client";
import { LogoutDialog, ShellActions, useLogout } from "@/app/session-actions";
import { IconButton } from "@/components/button";
import { LoadingState } from "@/components/feedback";
import { Drawer } from "@/components/overlays";
import { UserMenu } from "@/components/platform/user-menu";
import { useApiQuery } from "@/hooks/use-api";
import { resolveSiteName } from "@/lib/site-name";
import type { Resource } from "@/types/collaboration";
import { ArrowLeft } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useMatch } from "react-router";
import type { AgentNavigationSummary, SessionSummary } from "@/types/agents";
import {
  SessionHeadingContext,
  type SessionHeading,
} from "@/features/agents/chat/navigation-context";
import { ConversationSidebar } from "@/features/agents/chat/conversation-sidebar";
import { workspaceBreadcrumbs } from "../pages/workspace-breadcrumbs";
import { WorkspaceSidebar } from "../pages/workspace-sidebar";
import { ProjectSidebar, TeamSidebar } from "../pages/resource-sidebar";
import {
  PersonalSettingsSidebar,
  personalSettingsBreadcrumbs,
  personalSettingsLabel,
  personalSettingsSection,
} from "../pages/personal-settings-navigation";
import { resolveWorkspaceProjectView } from "../pages/workspace-navigation";
import { rememberConversation } from "../pages/conversation-memory";
import { Frame } from "./frame";
export function Shell() {
  const cache = useQueryClient();
  const location = useLocation();
  const settingsMatch = useMatch("/account/*");
  const settingsSection = settingsMatch
    ? personalSettingsSection(location.pathname, location.search)
    : undefined;
  const [settingsReturnTo, setSettingsReturnTo] = useState<string>();
  const entryReturnTo = (
    location.state as { personalSettingsReturnTo?: string } | null
  )?.personalSettingsReturnTo;
  // Credential links create their own history entries during the settings visit.
  const returnTo = settingsMatch
    ? (entryReturnTo ?? settingsReturnTo)
    : undefined;
  if (returnTo !== settingsReturnTo) setSettingsReturnTo(returnTo);
  const { user } = useSession();
  const [heading, setHeading] = useState<SessionHeading>();
  const [mobile, setMobile] = useState(false);
  const logout = useLogout();
  const { settings } = useAuth();
  const brand = resolveSiteName(settings.site_name);
  const conversationArea =
    location.pathname === "/chats" || location.pathname.startsWith("/chats/");
  const sessionId = location.pathname.match(/^\/chats\/([1-9]\d*)\/?$/)?.[1];
  const activeHeading = heading?.sessionId === sessionId ? heading : undefined;
  const config = activeHeading?.configuration;
  const missingSession = activeHeading?.unavailable;
  // Reuse the visible list row while the selected conversation opens.
  const listedSession =
    sessionId && !config && !missingSession
      ? cache
          .getQueriesData<
            | ApiResponse<SessionSummary[]>
            | InfiniteData<ApiResponse<SessionSummary[]>>
          >({ queryKey: ["agent-sessions"] })
          .flatMap(([, result]) =>
            !result
              ? []
              : "pages" in result
                ? result.pages.flatMap((page) => page.data)
                : result.data,
          )
          .find((session) => session.id === sessionId)
      : undefined;
  const agentId = sessionId
    ? (config?.agent_id ?? listedSession?.agent_id)
    : new URLSearchParams(location.search).get("agent") || undefined;
  useEffect(() => {
    if (conversationArea && sessionId && config && agentId)
      rememberConversation(user.id, { agentId, sessionId });
  }, [conversationArea, agentId, sessionId, config, user.id]);
  const summary = useApiQuery<AgentNavigationSummary>(
    ["agent-summary", agentId],
    `/agents/${agentId}/summary`,
    { enabled: conversationArea && Boolean(agentId) },
  );
  const conversationCrumbs = missingSession
    ? [{ label: "对话" }]
    : [
        { label: "对话", ...(agentId || sessionId ? { to: "/chats" } : {}) },
        ...(agentId
          ? [
              {
                label:
                  summary.data?.data.name ??
                  (summary.isError ? "助手不可用" : "加载助手…"),
                ...(sessionId ? { to: `/chats?agent=${agentId}` } : {}),
              },
            ]
          : []),
        ...(sessionId
          ? [
              {
                label: config?.title ?? listedSession?.title ?? "加载会话…",
              },
            ]
          : agentId
            ? [{ label: "新对话" }]
            : []),
      ];
  const projectId = location.pathname.match(/^\/projects\/([1-9]\d*)/)?.[1];
  const teamId = location.pathname.match(/^\/teams\/([1-9]\d*)(?:\/|$)/)?.[1];
  const project = useApiQuery<Resource>(
    ["project", projectId],
    `/projects/${projectId ?? ""}`,
    { enabled: Boolean(projectId) },
  );
  const team = useApiQuery<Resource>(
    ["team", teamId],
    `/teams/${teamId ?? ""}`,
    { enabled: Boolean(teamId) },
  );
  const projectView = resolveWorkspaceProjectView(
    location.pathname,
    location.search,
  );
  const navigation = (compact: boolean, close?: () => void) => (
    <div
      className="sidebar-navigation"
      data-compact={compact}
      data-mode="workspace"
    >
      <Link
        to="/home"
        className="workspace-brand"
        aria-label={brand}
        title={brand}
        onClick={close}
      >
        {compact ? (
          <img src="/logo-inverse.svg" alt="" className="size-7" />
        ) : (
          <>
            <img src="/logo.svg" alt="" className="size-7 dark:hidden" />
            <img
              src="/logo-inverse.svg"
              alt=""
              className="hidden size-7 dark:block"
            />
          </>
        )}
      </Link>
      <div className="sidebar-scroll">
        <WorkspaceSidebar close={close} />
      </div>
      <UserMenu
        compact={compact}
        onLogout={logout.open}
        onNavigate={close}
        area="workspace"
      />
    </div>
  );
  return (
    <SessionHeadingContext value={setHeading}>
      <Frame
        navigation={navigation(true)}
        resourceDetail={Boolean(settingsSection || projectView || teamId)}
        secondaryName={
          settingsSection
            ? personalSettingsLabel
            : conversationArea
              ? "对话"
              : teamId
                ? "团队"
                : "项目"
        }
        secondary={
          settingsSection ? (
            <PersonalSettingsSidebar active={settingsSection.key} />
          ) : conversationArea ? (
            <ConversationSidebar
              agentId={agentId}
              agentName={summary.data?.data.name}
              ready={missingSession || !sessionId || Boolean(agentId)}
            />
          ) : projectView &&
            project.data?.data &&
            !location.pathname.includes("/variants") ? (
            <ProjectSidebar project={project.data.data} view={projectView} />
          ) : teamId && team.data?.data ? (
            <TeamSidebar team={team.data.data} />
          ) : undefined
        }
        crumbs={
          settingsSection
            ? personalSettingsBreadcrumbs(location.pathname, location.search)
            : conversationArea
              ? conversationCrumbs
              : workspaceBreadcrumbs(
                  location.pathname,
                  location.search,
                  project.data?.data,
                  team.data?.data.name,
                )
        }
        onOpenNavigation={() => setMobile(true)}
        actions={
          <>
            {settingsSection && (
              <IconButton
                label={
                  returnTo && returnTo !== "/home" ? "返回原页面" : "返回工作区"
                }
                render={<Link to={returnTo ?? "/home"} />}
                nativeButton={false}
                role="link"
              >
                <ArrowLeft />
              </IconButton>
            )}
            <ShellActions />
          </>
        }
        overlays={
          <>
            <Drawer
              open={mobile}
              title="页面导航"
              onClose={() => setMobile(false)}
            >
              {navigation(false, () => setMobile(false))}
            </Drawer>
            <LogoutDialog controller={logout} />
          </>
        }
      >
        <Suspense
          fallback={
            <div className="page">
              <LoadingState />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </Frame>
    </SessionHeadingContext>
  );
}
