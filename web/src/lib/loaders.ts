import { redirectDocument } from "react-router";
import { readIdentity } from "@/app/identity";
import { authHref } from "./navigation";
export async function identityLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const target =
    url.pathname +
    url.search +
    (url.hash ||
      (url.pathname + url.search === location.pathname + location.search
        ? location.hash
        : ""));
  const { setup, identity } = await readIdentity();
  if (setup !== "ready") throw redirectDocument(authHref("/setup", target));
  if (!identity) throw redirectDocument(authHref("/login", target));
  if (identity.session.require_password_change)
    throw redirectDocument(authHref("/required-password", target));
  return identity;
}
export async function adminLoader(args: { request: Request }) {
  const identity = await identityLoader(args);
  if (identity.session.user.role !== "admin")
    throw new Response("仅管理员可以访问控制台。", { status: 403 });
  return identity;
}
