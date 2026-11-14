import { useEffect, useRef, useState } from "react";

export function useDebouncedSearch(
  initial: string,
  apply: (value: string) => void,
  delay = 600,
) {
  const [value, setValue] = useState(initial);
  const composing = useRef(false);
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => setValue(initial), [initial]);
  useEffect(() => {
    if (value.trim() === initial.trim() || composing.current) return;
    const timer = setTimeout(() => latest.current(value.trim()), delay);
    return () => clearTimeout(timer);
  }, [value, initial, delay]);
  return {
    value,
    setValue,
    composing,
    submit: () => latest.current(value.trim()),
    compositionEnd: () => {
      composing.current = false;
      latest.current(value.trim());
    },
  };
}
