import type { ToolNode } from "./conversation-projection";

export function isPapiTool(name: string) {
  return name === "papi_list" || name === "papi_desc" || name === "papi_call";
}

export function toolIconActive(
  name: string,
  tool: Pick<ToolNode, "call" | "result" | "status" | "rejected">,
  active: boolean,
) {
  if (!isPapiTool(name)) return active;
  return (
    name === "papi_call" &&
    Boolean(tool.call) &&
    !tool.result &&
    !tool.rejected &&
    (tool.status === "dispatching" || tool.status === "running")
  );
}

// Only completed top-level strings are previewed. Never repair partial JSON or
// treat a draft as executable arguments. Bound work while file contents stream.
export function draftArgumentStrings(source: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  if (!source.trimStart().startsWith("{")) return values;
  const tokens =
    /\s*("(?:\\.|[^"\\])*"|[{}[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/gy;
  const prefix = source.slice(0, 8192);
  let depth = 0;
  let key: string | undefined;
  let expecting: "key" | "colon" | "value" | "comma" = "key";
  for (let token = tokens.exec(prefix); token; token = tokens.exec(prefix)) {
    const value = token[1];
    if (value === "{" || value === "[") {
      if (!depth && value !== "{") break;
      if (depth === 1 && expecting === "value") expecting = "comma";
      depth++;
    } else if (value === "}" || value === "]") {
      if (--depth <= 0) break;
    } else if (depth === 1) {
      if (expecting === "key" && value.startsWith('"')) {
        try {
          key = JSON.parse(value);
        } catch {
          break;
        }
        expecting = "colon";
      } else if (expecting === "colon" && value === ":") {
        expecting = "value";
      } else if (expecting === "value") {
        if (key && value.startsWith('"')) {
          try {
            values[key] = JSON.parse(value);
          } catch {
            break;
          }
        }
        expecting = "comma";
      } else if (expecting === "comma" && value === ",") {
        expecting = "key";
      } else break;
    }
  }
  return values;
}

export function toolSummary(
  tool: Pick<ToolNode, "call" | "draft" | "question">,
) {
  const name =
    tool.call?.data.tool_key ??
    tool.draft?.name ??
    (tool.question ? "ask_user_question" : "");
  const args =
    tool.call?.data.arguments ??
    draftArgumentStrings(tool.draft?.argumentsText ?? "");
  const hint =
    (name === "papi_call" || name === "papi_desc") &&
    typeof tool.call?.data.arguments.api === "string"
      ? tool.call.data.arguments.api
      : (name === "glob" || name === "grep") && typeof args.pattern === "string"
        ? [args.pattern, typeof args.path === "string" ? args.path : null]
            .filter(Boolean)
            .join(" · ")
        : [
            args.path,
            args.file_path,
            args.destination,
            args.command,
            args.pattern,
            args.query,
            args.url,
          ].find(
            (value): value is string =>
              typeof value === "string" && Boolean(value),
          );
  return { name, hint };
}
