export interface RecentResource {
  id: string;
  name: string;
  kind: "project" | "team";
  to: string;
}
const keyFor = (user: string) => `antcdp.recent.${user}`;

export function recentResources(user: string): RecentResource[] {
  try {
    const value: unknown = JSON.parse(
      sessionStorage.getItem(keyFor(user)) ?? "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .flatMap((item): RecentResource[] => {
        if (typeof item !== "object" || item === null) return [];
        const record = item as Record<string, unknown>;
        if (
          typeof record.id !== "string" ||
          typeof record.name !== "string" ||
          typeof record.to !== "string"
        )
          return [];
        if (record.kind !== "project" && record.kind !== "team") return [];
        if (!/^\/(projects|teams)\/[1-9]\d*/.test(record.to)) return [];
        return [
          {
            id: record.id,
            name: record.name,
            kind: record.kind,
            to: record.to,
          },
        ];
      })
      .slice(0, 6);
  } catch {
    return [];
  }
}

export function recordRecent(user: string, resource: RecentResource) {
  try {
    const items = [
      resource,
      ...recentResources(user).filter(
        (item) => !(item.kind === resource.kind && item.id === resource.id),
      ),
    ].slice(0, 6);
    sessionStorage.setItem(keyFor(user), JSON.stringify(items));
  } catch {}
}
