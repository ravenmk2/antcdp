export interface User {
  id: string;
  username: string;
  display_name: string;
  role: "admin" | "user";
  is_founder: boolean;
  status: "active" | "disabled";
  avatar: { id: string; url: string } | null;
  version: string;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Session {
  user: User;
  expires_at: string;
  session_ttl_days: number;
  require_password_change: boolean;
}

export interface PublicSettings {
  site_name: string;
  timezone: string;
  registration_enabled: boolean;
  session_ttl_days: number;
}

export interface SetupStatus {
  state:
    | "setup_required"
    | "initializing"
    | "ready"
    | "recovery_required"
    | "unavailable";
  public_url: string;
}
