import { createContext, useContext, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { ApiError, resetCSRF } from "@/api/client";
import { useApiQuery } from "@/hooks/use-api";
import { authHref } from "@/lib/routes";
import type { PublicSettings, Session, SetupStatus } from "@/types/auth";
import { LoadingState, Notice } from "@/components/feedback";
import { Button } from "@/components/button";
import { SetupCompletionContext } from "@/hooks/use-setup-completion";

const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  display_name: z.string(),
  role: z.enum(["admin", "user"]),
  is_founder: z.boolean(),
  status: z.enum(["active", "disabled"]),
  avatar: z.object({ id: z.string(), url: z.string() }).nullable(),
  version: z.string(),
  last_login_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const sessionSchema = z.object({
  user: userSchema,
  expires_at: z.string(),
  session_ttl_days: z.number(),
  require_password_change: z.boolean(),
}) satisfies z.ZodType<Session>;
const settingsSchema = z.object({
  site_name: z.string(),
  timezone: z.string(),
  registration_enabled: z.boolean(),
  session_ttl_days: z.number(),
}) satisfies z.ZodType<PublicSettings>;

interface AuthValue {
  session: Session | null;
  settings: PublicSettings;
}
const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is required");
  return value;
}

export function useSession() {
  const session = useAuth().session;
  if (!session) throw new Error("An authenticated session is required");
  return session;
}

export function AppRoot() {
  const route = useLocation();
  const [completedLocation, setCompletedLocation] = useState<string | null>(
    null,
  );
  if (completedLocation !== null && completedLocation !== route.key) {
    setCompletedLocation(null);
  }
  const setup = useApiQuery<SetupStatus>(["setup"], "/setup/status", {
    staleTime: 0,
  });
  const setupContent = (
    <SetupCompletionContext value={() => setCompletedLocation(route.key)}>
      <Outlet />
    </SetupCompletionContext>
  );
  if (route.pathname === "/setup" && completedLocation === route.key)
    return setupContent;
  if (setup.isPending)
    return (
      <main className="grid min-h-dvh place-items-center">
        <LoadingState label="正在检查系统状态…" />
      </main>
    );
  if (setup.isError)
    return (
      <ConnectionFailure
        error={setup.error}
        retry={() => void setup.refetch()}
      />
    );
  const state = setup.data.data.state;
  if (state === "setup_required") {
    return route.pathname === "/setup" ? (
      setupContent
    ) : (
      <Navigate to="/setup" replace />
    );
  }
  if (state !== "ready")
    return <InstanceStatus state={state} retry={() => void setup.refetch()} />;
  return <SessionProvider />;
}

function SessionProvider() {
  const location = useLocation();
  const settings = useApiQuery<PublicSettings>(
    ["public-settings"],
    "/public/settings",
    { schema: settingsSchema },
  );
  const session = useApiQuery<Session>(["session"], "/auth/session", {
    schema: sessionSchema,
    retry: false,
  });
  const unauthenticated =
    session.error instanceof ApiError &&
    session.error.code === "UNAUTHENTICATED";
  useEffect(() => {
    const handler = (event: Event) => {
      const code =
        event instanceof CustomEvent ? String(event.detail) : "UNAUTHENTICATED";
      const target =
        code === "PASSWORD_CHANGE_REQUIRED" ? "/required-password" : "/login";
      window.location.replace(authHref(target));
    };
    window.addEventListener("antcdp:auth-failure", handler);
    return () => window.removeEventListener("antcdp:auth-failure", handler);
  }, []);
  if (settings.isPending || session.isPending)
    return (
      <main className="grid min-h-dvh place-items-center">
        <LoadingState />
      </main>
    );
  if (settings.isError || (session.isError && !unauthenticated)) {
    return (
      <ConnectionFailure
        error={settings.error ?? session.error}
        retry={() => {
          void settings.refetch();
          void session.refetch();
        }}
      />
    );
  }
  const value: AuthValue = {
    session: unauthenticated ? null : (session.data?.data ?? null),
    settings: settings.data.data,
  };
  if (location.pathname === "/setup")
    return <Navigate to={value.session ? "/home" : "/login"} replace />;
  return (
    <AuthContext value={value}>
      <Outlet />
    </AuthContext>
  );
}

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (!auth.session)
    return (
      <Navigate
        to={authHref(
          "/login",
          location.pathname + location.search + location.hash,
        )}
        replace
      />
    );
  if (
    auth.session.require_password_change &&
    location.pathname !== "/required-password"
  ) {
    return (
      <Navigate
        to={authHref(
          "/required-password",
          location.pathname + location.search + location.hash,
        )}
        replace
      />
    );
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const session = useSession();
  if (session.user.role !== "admin") {
    return (
      <div className="page">
        <Notice tone="danger" title="无权访问">
          控制台仅对系统管理员开放。
        </Notice>
        <Button
          className="mt-4"
          variant="outline"
          onClick={() => window.location.assign("/home")}
        >
          返回工作区
        </Button>
      </div>
    );
  }
  return <Outlet />;
}

export function useLoginComplete() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (target: string) => {
    resetCSRF();
    await queryClient.invalidateQueries();
    window.location.replace(new URL(target, location.origin).href);
    navigate(target, { replace: true });
  };
}

function ConnectionFailure({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="auth-page">
      <section className="panel w-full max-w-lg p-8 text-center">
        <img src="/logo.svg" alt="AntCDP" className="mx-auto mb-5 size-12" />
        <h1 className="text-2xl font-semibold">暂时无法连接系统</h1>
        <p className="my-4 text-sm leading-6 text-muted">
          请检查服务与数据库状态。连接异常不会被视为未安装，也不会清空已有数据。
        </p>
        <Notice tone="danger">
          {error instanceof Error ? error.message : "服务暂不可用"}
        </Notice>
        <Button className="mt-5" onClick={retry}>
          重新检查
        </Button>
      </section>
    </main>
  );
}

function InstanceStatus({
  state,
  retry,
}: {
  state: SetupStatus["state"];
  retry: () => void;
}) {
  const initializing = state === "initializing";
  useEffect(() => {
    if (!initializing) return;
    const timer = setTimeout(retry, 2000);
    return () => clearTimeout(timer);
  }, [initializing, retry]);
  return (
    <main className="auth-page">
      <section className="panel w-full max-w-lg p-8">
        <img src="/logo.svg" alt="AntCDP" className="mb-5 size-12" />
        <h1 className="text-2xl font-semibold">
          {initializing
            ? "系统正在初始化"
            : state === "recovery_required"
              ? "安装需要恢复检查"
              : "系统暂不可用"}
        </h1>
        <p className="my-4 text-sm leading-6 text-muted">
          {initializing
            ? "请等待安装状态稳定，页面会自动重新检查。"
            : "检测到已有安装记录或运行异常。请联系部署维护者核对安装锁、数据库与备份，不要重复安装。"}
        </p>
        {!initializing && (
          <Button variant="outline" onClick={retry}>
            重新读取状态
          </Button>
        )}
      </section>
    </main>
  );
}
