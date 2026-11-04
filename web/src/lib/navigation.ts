export const businessRoute =
  /^\/(?:(?:admin|account|projects\/[1-9]\d*)\/(?:integrations|remote-hosts)(?:\/[1-9]\d*)?|admin\/(?:email|sms)(?:\/(?:profiles|templates|send-logs)(?:\/[1-9]\d*)?|\/templates\/new)?|admin\/dingtalk(?:\/[1-9]\d*)?|home|account(?:\/security)?|admin(?:\/(?:users|settings|audit))?|(?:admin\/)?(?:projects(?:\/[1-9]\d*(?:\/variants)?)?|teams(?:\/[1-9]\d*)?))?\/?$/;

// URL parsing silently strips some control characters. Reject them before parsing.
// eslint-disable-next-line no-control-regex
const unsafeCharacter = /[\\\u0000-\u0020]/;

// Normalize bookmarks made under the preview prefix before restoring a session.
export function safeReturnTo(value: unknown, origin: string): string | null {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    unsafeCharacter.test(value)
  )
    return null;
  try {
    const url = new URL(value, origin);
    const path = url.pathname.replace(/^\/next(?:\/|$)/, "/");
    if (
      url.origin !== origin ||
      !businessRoute.test(path) ||
      path.startsWith("//")
    )
      return null;
    return path + url.search + url.hash;
  } catch {
    return null;
  }
}
export function appHref(path: string) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    unsafeCharacter.test(path)
  )
    throw new Error("Invalid application path");
  const url = new URL(path, "https://antcdp.invalid");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function returnTarget(url: URL) {
  return safeReturnTo(url.searchParams.get("return_to"), url.origin) || "/home";
}
export function authHref(
  path: "/login" | "/register" | "/required-password" | "/setup",
  target = location.pathname + location.search + location.hash,
) {
  const url = new URL(appHref(path), location.origin);
  const safe = safeReturnTo(target, location.origin);
  if (safe) url.searchParams.set("return_to", safe);
  return url.href;
}
