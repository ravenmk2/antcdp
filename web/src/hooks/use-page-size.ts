import { useState } from "react";

export function usePageSize(key: string, fallback = 20) {
  const [size, setSize] = useState(() => {
    try {
      const value = Number(localStorage.getItem(`antcdp.page-size.${key}`));
      return [10, 20, 50, 100].includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  });
  function update(value: number) {
    const valid = [10, 20, 50, 100].includes(value) ? value : fallback;
    setSize(valid);
    try {
      localStorage.setItem(`antcdp.page-size.${key}`, String(valid));
    } catch {}
  }
  return [size, update] as const;
}
