import type { ChatMessage } from './types';

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type ChatSessionStorage = {
  version: 1;
  activeSessionId: string | null;
  sessions: ChatSession[];
};

const STORAGE_PREFIX = 'knowledge-chat-sessions:v1';
const DEFAULT_TITLE = '新会话';

export function chatStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === 'user' || message.role === 'assistant') && typeof message.id === 'string'
  );
}

function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter(isChatMessage).map((message) => {
    if (
      message.role === 'assistant' &&
      (message.status === 'searching' || message.status === 'generating')
    ) {
      return { ...message, status: 'stopped' as const };
    }
    return message;
  });
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const title = firstUserMessage?.content.trim();
  if (!title) return DEFAULT_TITLE;
  return title.length > 40 ? `${title.slice(0, 40)}...` : title;
}

export function loadChatSessions(userId: string): ChatSessionStorage {
  if (typeof localStorage === 'undefined') {
    return { version: 1, activeSessionId: null, sessions: [] };
  }

  try {
    const raw = localStorage.getItem(chatStorageKey(userId));
    if (!raw) return { version: 1, activeSessionId: null, sessions: [] };

    const parsed = JSON.parse(raw) as Partial<ChatSessionStorage>;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      return { version: 1, activeSessionId: null, sessions: [] };
    }

    const sessions = parsed.sessions
      .filter((session): session is ChatSession => !!session && typeof session.id === 'string')
      .map((session) => ({
        id: session.id,
        title: typeof session.title === 'string' && session.title ? session.title : DEFAULT_TITLE,
        createdAt:
          typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
        updatedAt:
          typeof session.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
        messages: sanitizeMessages(session.messages),
      }))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

    const activeSessionId =
      typeof parsed.activeSessionId === 'string' &&
      sessions.some((session) => session.id === parsed.activeSessionId)
        ? parsed.activeSessionId
        : null;

    return { version: 1, activeSessionId, sessions };
  } catch (error) {
    console.warn('[chat] failed to load chat sessions', error);
    return { version: 1, activeSessionId: null, sessions: [] };
  }
}

export function saveChatSessions(userId: string, storage: ChatSessionStorage): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(chatStorageKey(userId), JSON.stringify(storage));
}

export function upsertActiveChatSession(
  storage: ChatSessionStorage,
  conversation: { messages: ChatMessage[] },
  activeSessionId: string,
): ChatSessionStorage {
  if (conversation.messages.length === 0) return storage;

  const now = new Date().toISOString();
  const existing = storage.sessions.find((session) => session.id === activeSessionId);
  const session: ChatSession = {
    id: activeSessionId,
    title: deriveTitle(conversation.messages),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    messages: conversation.messages,
  };

  return {
    ...storage,
    activeSessionId,
    sessions: [session, ...storage.sessions.filter((session) => session.id !== activeSessionId)],
  };
}

export function clearActiveChatSession(
  storage: ChatSessionStorage,
  sessionId: string,
): ChatSessionStorage {
  return {
    ...storage,
    activeSessionId: null,
    sessions: storage.sessions.filter((session) => session.id !== sessionId),
  };
}
