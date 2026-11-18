type LastConversation = { agentId: string; sessionId?: string };
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[1-9]\d*$/.test(value);
const key = (userId: string) => `antcdp.workspace.last-conversation:${userId}`;

export function lastAgentConversationPath(userId: string): string | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(key(userId)) || "null",
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("agentId" in value) ||
      !validId(value.agentId)
    )
      return null;
    return `/chats?agent=${value.agentId}`;
  } catch {
    return null;
  }
}

export function rememberConversation(userId: string, value: LastConversation) {
  if (
    !validId(value.agentId) ||
    (value.sessionId !== undefined && !validId(value.sessionId))
  )
    return;
  try {
    localStorage.setItem(key(userId), JSON.stringify(value));
  } catch {
    /* Navigation remains usable when browser storage is unavailable. */
  }
}

export function forgetUnavailableAgent(userId: string, agentId: string) {
  if (lastAgentConversationPath(userId) !== `/chats?agent=${agentId}`) return;
  try {
    localStorage.removeItem(key(userId));
  } catch {
    /* The current view can still render without browser storage. */
  }
}
