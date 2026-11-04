export type InstallState =
  | "setup_required"
  | "initializing"
  | "ready"
  | "recovery_required"
  | "unavailable";
export interface Status {
  state: InstallState;
  public_url: string;
}
export interface Database {
  host: string;
  port: number;
  name: string;
  username: string;
  password: string;
  tls_mode: "disabled" | "verify_identity";
}
export interface InstallRequest {
  database: Database;
  site: { site_name: string; timezone: string };
  founder: { username: string; display_name: string; password: string };
}
