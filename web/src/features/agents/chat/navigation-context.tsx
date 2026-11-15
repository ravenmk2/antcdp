import {
  createContext,
  useContext,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SessionConfiguration } from "@/types/agents";

export const SessionHeadingContext = createContext<Dispatch<
  SetStateAction<SessionConfiguration | undefined>
> | null>(null);

export function useSessionHeading(
  configuration: SessionConfiguration | undefined,
  service: boolean,
) {
  const publish = useContext(SessionHeadingContext);
  useEffect(() => {
    if (!service && configuration) publish?.(configuration);
  }, [configuration, publish, service]);
}
