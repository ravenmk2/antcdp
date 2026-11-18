import {
  createContext,
  useContext,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { SessionConfiguration } from "@/types/agents";

export interface SessionHeading {
  sessionId: string;
  configuration?: SessionConfiguration;
  unavailable: boolean;
}

export const SessionHeadingContext = createContext<Dispatch<
  SetStateAction<SessionHeading | undefined>
> | null>(null);

export function useSessionHeading(
  sessionId: string | undefined,
  configuration: SessionConfiguration | undefined,
  unavailable: boolean,
) {
  const publish = useContext(SessionHeadingContext);
  useEffect(() => {
    if (sessionId && (configuration || unavailable))
      publish?.({ sessionId, configuration, unavailable });
  }, [sessionId, configuration, unavailable, publish]);
}
