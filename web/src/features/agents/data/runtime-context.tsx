import { ApiError, request } from "@/api/client";
import { useSession } from "@/app/auth";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AgentCommandStore } from "./command-store";
import { ConversationDraftStore } from "./draft-store";
import { ConversationSendStore } from "./send-flow";
import { AgentStreamClient } from "./stream-client";
import { SessionInvalidation } from "./session-invalidation";

interface Runtime {
  commands: AgentCommandStore;
  stream: AgentStreamClient;
  sends: ConversationSendStore;
  drafts: ConversationDraftStore;
}
class RuntimeResources implements Runtime {
  readonly invalidation: SessionInvalidation;
  constructor(cache: QueryClient) {
    this.invalidation = new SessionInvalidation(cache);
  }
  readonly commands = new AgentCommandStore();
  readonly sends = new ConversationSendStore(this.commands);
  readonly drafts = new ConversationDraftStore();
  readonly stream = new AgentStreamClient({
    onSessionsChanged: () => this.invalidation.changed(),
    checkAuthentication: async () => {
      try {
        await request("/auth/session");
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return false;
        throw error;
      }
    },
    onAuthenticationLost: () =>
      window.dispatchEvent(
        new CustomEvent("antcdp:auth-failure", { detail: "UNAUTHENTICATED" }),
      ),
  });
  private lifecycle = 0;
  retain() {
    const generation = ++this.lifecycle;
    this.stream.start();
    // StrictMode repeats setup/cleanup synchronously. Only dispose after a real
    // unmount, not during that verification cycle.
    return () =>
      queueMicrotask(() => {
        if (this.lifecycle === generation) {
          this.commands.dispose();
          this.sends.dispose();
          this.drafts.dispose();
          this.stream.dispose();
          this.invalidation.dispose();
        }
      });
  }
}
const AgentRuntimeContext = createContext<Runtime | null>(null);
function RuntimeScope({ children }: { children: ReactNode }) {
  const cache = useQueryClient();
  const [runtime] = useState(() => new RuntimeResources(cache));
  useEffect(() => runtime.retain(), [runtime]);
  return <AgentRuntimeContext value={runtime}>{children}</AgentRuntimeContext>;
}
export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  return <RuntimeScope key={user.id}>{children}</RuntimeScope>;
}
export function useAgentRuntime() {
  const runtime = useContext(AgentRuntimeContext);
  if (!runtime) throw new Error("AgentRuntimeProvider is required");
  return runtime;
}
