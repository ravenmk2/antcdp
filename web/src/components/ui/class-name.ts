import { cn } from "@/lib/utils";

// Preserve Base UI's state-aware styling while allowing local utility overrides.
export function withBaseClass<State>(
  base: string,
  className?: string | ((state: State) => string | undefined),
) {
  return typeof className === "function"
    ? (state: State) => cn(base, className(state))
    : cn(base, className);
}
