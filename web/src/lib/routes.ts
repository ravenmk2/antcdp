const existingBusinessRoute =
  /^\/(?:(?:admin(?:\/projects\/[1-9]\d*)?|account|projects\/[1-9]\d*)\/(?:integrations|remote-hosts)(?:\/[1-9]\d*)?|admin\/(?:email|sms)(?:\/(?:profiles|templates|send-logs)(?:\/[1-9]\d*|\/new)?|\/templates\/new)?|admin\/dingtalk(?:\/[1-9]\d*)?|(?:projects|teams)\/[1-9]\d*\/description\/edit|admin\/projects\/[1-9]\d*\/description\/edit|admin\/projects\/[1-9]\d*\/variants\/[1-9]\d*\/releases\/[1-9]\d*|admin\/teams\/[1-9]\d*\/description\/edit|admin\/models(?:\/(?:new|[1-9]\d*))?|home|account(?:\/security)?|admin(?:\/(?:users|settings|audit))?|(?:admin\/)?(?:projects(?:\/[1-9]\d*(?:\/variants(?:\/[1-9]\d*)?)?)?|teams(?:\/[1-9]\d*)?))?\/?$/;

export const businessRoute = new RegExp(
  `(?:${existingBusinessRoute.source})|(?:^/admin/(?:agents(?:/(?:new|[1-9]\\d*(?:/prompt|/debug(?:/[1-9]\\d*)?)?))?|robots|agent-usage|cloud-computers(?:/(?:settings|[1-9]\\d*))?|web-access(?:/(?:new|settings|[1-9]\\d*))?|mcp-servers(?:/(?:new|[1-9]\\d*))?|skills(?:/(?:new|[1-9]\\d*(?:/upload|/versions/[1-9]\\d*)?))?)/?$)|(?:^/agents(?:/sessions/[1-9]\\d*)?/?$)|(?:^/cloud-computer/?$)`,
);

// URL parsing strips some controls before route validation; reject them explicitly.
// eslint-disable-next-line no-control-regex
const unsafeCharacter = /[\\\u0000-\u0020]/;

export function appHref(path: string) {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    unsafeCharacter.test(path)
  ) {
    throw new Error("Invalid application path");
  }
  const url = new URL(path, "https://antcdp.invalid");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function safeReturnTo(value: unknown, origin: string) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    unsafeCharacter.test(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value, origin);
    const path = url.pathname.replace(/^\/next(?:\/|$)/, "/");
    if (
      url.origin !== origin ||
      !businessRoute.test(path) ||
      path.startsWith("//")
    ) {
      return null;
    }
    const project = path.match(
      /^(\/(?:admin\/)?projects\/[1-9]\d*)(?:\/variants(?:\/.*)?)?\/?$/,
    );
    if (
      project &&
      (path.includes("/variants") ||
        ["variants", "releases", "branch-model"].includes(
          url.searchParams.get("tab") ?? "",
        ) ||
        url.searchParams.get("section") === "branch-model" ||
        url.searchParams.has("release"))
    )
      return project[1]!;
    return path + url.search + url.hash;
  } catch {
    return null;
  }
}

export function returnTarget(url: URL) {
  return safeReturnTo(url.searchParams.get("return_to"), url.origin) ?? "/home";
}

export function authHref(
  path: "/login" | "/register" | "/required-password" | "/setup",
  target = location.pathname + location.search + location.hash,
) {
  const url = new URL(appHref(path), location.origin);
  const safe = safeReturnTo(target, location.origin);
  if (safe) url.searchParams.set("return_to", safe);
  return `${url.pathname}${url.search}`;
}
