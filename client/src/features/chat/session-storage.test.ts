import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearActiveChatSession,
  loadChatSessions,
  saveChatSessions,
  setActiveChatServerSession,
  upsertActiveChatSession,
} from './session-storage';
import type { ChatMessage } from './types';

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

describe('chat session storage', () => {
  it('损坏数据返回空存储', () => {
    const getItem = vi.fn().mockReturnValue('{broken');
    vi.stubGlobal('localStorage', { getItem });

    expect(loadChatSessions('user-1')).toEqual({
      version: 2,
      activeSessionId: null,
      sessions: [],
    });
  });

  it('恢复时把进行中消息标记为已停止', () => {
    const saved = {
      version: 1,
      activeSessionId: 'session-1',
      sessions: [
        {
          id: 'session-1',
          title: '',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          messages: [
            { id: 'a1', role: 'assistant', content: '', status: 'generating', sources: [] },
          ],
        },
      ],
    };
    const getItem = vi.fn().mockReturnValue(JSON.stringify(saved));
    vi.stubGlobal('localStorage', { getItem });

    const storage = loadChatSessions('user-1');
    expect(storage.sessions[0].messages[0].status).toBe('stopped');
    expect(storage.sessions[0].title).toBe('新会话');
  });

  it('upsert 会话并自动取第一条提问作标题', () => {
    const current: { messages: ChatMessage[]; activeAssistantId: null } = {
      messages: [
        { id: 'u1', role: 'user', content: '文本向量化是什么' },
        { id: 'a1', role: 'assistant', content: '向量', status: 'done', sources: [] },
      ],
      activeAssistantId: null,
    };
    const storage = upsertActiveChatSession(
      {
        version: 1,
        activeSessionId: 'session-1',
        sessions: [],
      },
      current,
      'session-1',
    );

    expect(storage.sessions).toHaveLength(1);
    expect(storage.sessions[0].title).toBe('文本向量化是什么');
  });

  it('清空当前会话并移除 activeSessionId', () => {
    const storage = {
      version: 1 as const,
      activeSessionId: 'session-1',
      sessions: [{ id: 'session-1', title: '旧', createdAt: '', updatedAt: '', messages: [] }],
    };
    const next = clearActiveChatSession(storage, 'session-1');

    expect(next.sessions).toEqual([]);
    expect(next.activeSessionId).toBeNull();
    expect(saveChatSessions('user-1', next)).toBeUndefined();
  });
});

describe('chat session storage D7', () => {
  it('preserves serverSessionId and workspace scope', () => {
    const storage = {
      version: 2 as const,
      activeSessionId: 'local-1',
      sessions: [
        {
          id: 'local-1',
          title: 'SEO',
          workspaceId: 'workspace-1',
          serverSessionId: 'server-1',
          createdAt: '',
          updatedAt: '',
          messages: [],
        },
      ],
    };
    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(JSON.stringify(storage)) });

    expect(loadChatSessions('user-1', 'workspace-1')).toEqual(storage);
    expect(loadChatSessions('user-1', 'workspace-2').sessions).toEqual([]);
  });

  it('stores a returned server session on the active local session', () => {
    const storage = {
      version: 2 as const,
      activeSessionId: 'local-1',
      sessions: [{ id: 'local-1', title: '当前', createdAt: '', updatedAt: '', messages: [] }],
    };
    const next = setActiveChatServerSession(storage, 'local-1', 'server-9');

    expect(next.version).toBe(2);
    expect(next.sessions[0]?.serverSessionId).toBe('server-9');
  });
});
