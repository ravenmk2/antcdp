import { ref, watch } from "vue";

export const pageSizes = [10, 20, 50, 100] as const;
export function usePageSize(list: "users" | "audit") {
  const key = `antcdp.page-size.${list}`;
  let initial = 10;
  try {
    const saved = Number(localStorage.getItem(key));
    if (pageSizes.some(size => size === saved)) initial = saved;
  } catch { /* Storage restrictions must not prevent using the list. */ }
  const pageSize = ref(initial);
  watch(pageSize, value => {
    try { localStorage.setItem(key, String(value)); } catch { /* Keep this session's choice. */ }
  });
  return pageSize;
}
