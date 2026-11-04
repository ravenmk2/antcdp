export function savedPageSize(list: "users" | "audit") {
  try {
    const value = Number(localStorage.getItem(`antcdp.page-size.${list}`));
    if ([10, 20, 50, 100].includes(value)) return value;
  } catch {
    /* Restricted storage does not prevent listing records. */
  }
  return 10;
}
export function rememberPageSize(list: "users" | "audit", value: number) {
  try {
    localStorage.setItem(`antcdp.page-size.${list}`, String(value));
  } catch {
    /* The URL still preserves the current choice. */
  }
}
