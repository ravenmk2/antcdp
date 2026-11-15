import { useAuth, useSession } from "@/app/auth";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type { ApiResponse } from "@/api/client";
import { LogoutDialog, ShellActions, useLogout } from "@/app/session-actions";
import { LoadingState } from "@/components/feedback";
import { Drawer } from "@/components/overlays";
import { UserMenu } from "@/components/platform/user-menu";
import { useApiQuery } from "@/hooks/use-api";
import { resolveSiteName } from "@/lib/site-name";
import type { Resource } from "@/types/collaboration";
import { Suspense, useEffect, useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import type {
  AgentNavigationSummary,
  SessionConfiguration,
  SessionDetail,
  SessionSummary,
} from "@/types/agents";
import { SessionHeadingContext } from "@/features/agents/chat/navigation-context";
import { ConversationSidebar } from "@/features/agents/chat/conversation-sidebar";
import { workspaceBreadcrumbs } from "../pages/workspace-breadcrumbs";
import { WorkspaceSidebar } from "../pages/workspace-sidebar";
import { rememberConversation } from "../pages/conversation-memory";
import { Frame } from "./frame";
export function Shell() {
  const cache = useQueryClient();
  const location = useLocation();
  const { user } = useSession();
  const [heading, setHeading] = useState<SessionConfiguration>();
  const [mobile, setMobile] = useState(false);
  const logout = useLogout();
  const { settings } = useAuth();
  const brand = resolveSiteName(settings.site_name);
  const conversationArea =
    location.pathname === "/agents" || location.pathname.startsWith("/agents/");
  const sessionId = location.pathname.match(
    /^\/agents\/sessions\/([1-9]\d*)\/?$/,
  )?.[1];
  const detail = useApiQuery<SessionDetail>(
    ["agent-session", sessionId, "detail"],
    `/agents/sessions/${sessionId}`,
    { enabled: Boolean(sessionId) },
  );
  const config =
    heading?.id === sessionId ? heading : detail.data?.data.configuration;
  // List navigation already knows the owner; don't unmount its history while
  // fetching the newly selected session's detail.
  const listedSession =
    sessionId && !config
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
    if (conversationArea && agentId)
      rememberConversation(user.id, { agentId, sessionId });
  }, [conversationArea, agentId, sessionId, user.id]);
  const summary = useApiQuery<AgentNavigationSummary>(
    ["agent-summary", agentId],
    `/agents/${agentId}/summary`,
    { enabled: conversationArea && Boolean(agentId) },
  );
  const conversationCrumbs = [
    { label: "对话", ...(agentId || sessionId ? { to: "/agents" } : {}) },
    ...(agentId
      ? [
          {
            label:
              summary.data?.data.name ??
              (summary.isError ? "智能体不可用" : "加载智能体…"),
            ...(sessionId ? { to: `/agents?agent=${agentId}` } : {}),
          },
        ]
      : []),
    ...(sessionId
      ? [
          {
            label:
              config?.title ?? (detail.isError ? "会话不可用" : "加载会话…"),
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
        <img src="/logo.svg" alt="" className="size-7 dark:hidden" />
        <img
          src="/logo-inverse.svg"
          alt=""
          className="hidden size-7 dark:block"
        />
      </Link>
      <div className="sidebar-scroll">
        <WorkspaceSidebar compact={compact} close={close} />
      </div>
      <UserMenu compact={compact} onLogout={logout.open} area="workspace" />
    </div>
  );
  return (
    <SessionHeadingContext value={setHeading}>
      <Frame
        navigation={navigation(true)}
        secondary={
          conversationArea ? (
            <ConversationSidebar
              agentId={agentId}
              agentName={summary.data?.data.name}
              ready={!sessionId || Boolean(agentId)}
            />
          ) : undefined
        }
        crumbs={
          conversationArea
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
            <ShellActions projectId={projectId} />
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
