import { createContext, useContext } from "react";
import { api, ApiError } from "@/lib/api";

export interface User {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "user";
  is_founder: boolean;
  status: "active" | "disabled";
  version: string;
  avatar: { id: string; url: string } | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}
export interface Session {
  user: User;
  expires_at: string;
  session_ttl_days: number;
  require_password_change: boolean;
}
export interface Identity {
  session: Session;
  settings: {
    site_name: string;
    timezone: string;
    registration_enabled: boolean;
    session_ttl_days: number;
  };
}
export const IdentityContext = createContext<Identity | null>(null);
export function useIdentity() {
  const value = useContext(IdentityContext);
  if (!value) throw new Error("Missing identity provider");
  return value;
}
let pending: Promise<{ setup: string; identity: Identity | null }> | undefined;
export function invalidateIdentity() {
  // A post-write navigation must not inherit a pre-write visibility check.
  pending = undefined;
}
export function readIdentity() {
  if (pending) return pending;
  const run = async () => {
    const setup = await api<{ state: string }>("/setup/status");
    if (setup.state !== "ready") return { setup: setup.state, identity: null };
    try {
      const [session, settings] = await Promise.all([
        api<Session>("/auth/session"),
        api<Identity["settings"]>("/public/settings"),
      ]);
      return { setup: "ready", identity: { session, settings } };
    } catch (error) {
      if (error instanceof ApiError && error.code === "UNAUTHENTICATED")
        return { setup: "ready", identity: null };
      throw error;
    }
  };
  const result = run();
  pending = result;
  void result
    .finally(() => {
      if (pending === result) pending = undefined;
    })
    .catch(() => {});
  return result;
}
