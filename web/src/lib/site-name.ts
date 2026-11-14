export const DEFAULT_SITE_NAME = "ANTCDP";

export function resolveSiteName(name?: string) {
  return name?.trim() || DEFAULT_SITE_NAME;
}
