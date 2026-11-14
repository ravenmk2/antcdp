import type { FileRef } from "@/types/agents";
export interface ConversationDraft {
  text: string;
  files: File[];
  file_refs: FileRef[];
  agentId: string;
  modelId: string;
  thinking: string;
  projectId?: string | null;
}
export class ConversationDraftEntry {
  private value: ConversationDraft = {
    text: "",
    files: [],
    file_refs: [],
    agentId: "",
    modelId: "",
    thinking: "",
  };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  patch(value: Partial<ConversationDraft>) {
    this.value = { ...this.value, ...value };
    this.listeners.forEach((listener) => listener());
  }
  clearContent() {
    this.patch({ text: "", files: [], file_refs: [] });
  }
  dispose() {
    this.value = {
      text: "",
      files: [],
      file_refs: [],
      agentId: "",
      modelId: "",
      thinking: "",
    };
    this.listeners.clear();
  }
}
export class ConversationDraftStore {
  private drafts = new Map<string, ConversationDraftEntry>();
  get(id: string) {
    let draft = this.drafts.get(id);
    if (!draft) {
      draft = new ConversationDraftEntry();
      this.drafts.set(id, draft);
    }
    return draft;
  }
  dispose() {
    this.drafts.forEach((draft) => draft.dispose());
    this.drafts.clear();
  }
}
