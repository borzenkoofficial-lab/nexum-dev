export type ProjectConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  attachments?: string[];
};

type ConversationStorage = {
  getItem(key: string): string | null;
};

export function readProjectConversation(
  projectId: string,
  storage: ConversationStorage,
): ProjectConversationMessage[] {
  try {
    const saved: unknown = JSON.parse(storage.getItem("nexum:conversation:" + projectId) || "[]");
    return Array.isArray(saved) ? saved.slice(-100) as ProjectConversationMessage[] : [];
  } catch {
    return [];
  }
}

export function shouldPersistProjectConversation(
  activeProjectId: string,
  loadedProjectId: string | null,
): boolean {
  return Boolean(activeProjectId) && activeProjectId === loadedProjectId;
}

export function conversationForProject(
  targetProjectId: string,
  loadedProjectId: string | null,
  currentConversation: ProjectConversationMessage[],
  storage: ConversationStorage,
): ProjectConversationMessage[] {
  return targetProjectId === loadedProjectId
    ? currentConversation
    : readProjectConversation(targetProjectId, storage);
}
