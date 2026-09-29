import { afterEach, describe, expect, it, vi } from 'vitest';
import { askKnowledgeBase } from './api';
import type { ChatSseEvent } from './types';

vi.mock('../../lib/auth', () => ({
  getAccessToken: vi.fn(() => 'token-123'),
}));

function sseBody(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('event: sources\ndata: {"sources":[]}\n\n'));
      controller.enqueue(encoder.encode('event: delta\ndata: {"content":"回答"}\n\n'));
      controller.enqueue(encoder.encode('event: done\ndata: {"done":true}\n\n'));
      controller.close();
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('askKnowledgeBase', () => {
  it('用 POST JSON 和 access token 请求，并解析 SSE 事件', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: sseBody() });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const events: ChatSseEvent[] = [];
    await askKnowledgeBase({
      workspaceId: 'workspace-123',
      question: 'pgvector 是什么？',
      limit: 3,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/workspace-123/chat',
      expect.objectContaining({
        method: 'POST',
        signal: controller.signal,
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: 'Bearer token-123',
        }),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      question: 'pgvector 是什么？',
      limit: 3,
    });
    expect(events).toEqual([
      { type: 'sources', sources: [] },
      { type: 'delta', content: '回答' },
      { type: 'done', done: true },
    ]);
  });

  it('非 2xx 响应转换为用户可读错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(''),
      }),
    );

    await expect(
      askKnowledgeBase({
        workspaceId: 'workspace-123',
        question: '问题',
        signal: new AbortController().signal,
        onEvent: () => undefined,
      }),
    ).rejects.toThrow('请先登录后再提问');
  });
});

describe('askKnowledgeBase D7 session', () => {
  it('sends optional server sessionId and parses appended session/actions events', async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: session\ndata: {"session":{"id":"server-1","title":"SEO"}}\n\n'),
        );
        controller.enqueue(
          encoder.encode(
            'event: actions\ndata: {"actions":[{"id":"files","type":"navigate","label":"文件","href":"/files"}]}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('event: done\ndata: {"done":true}\n\n'));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body });
    vi.stubGlobal('fetch', fetchMock);
    const events: ChatSseEvent[] = [];

    await askKnowledgeBase({
      workspaceId: 'workspace-123',
      question: '有多少问题',
      sessionId: 'server-0',
      onEvent: (event) => events.push(event),
    });

    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      question: '有多少问题',
      limit: 5,
      sessionId: 'server-0',
    });
    expect(events).toEqual([
      { type: 'session', session: { id: 'server-1', title: 'SEO' } },
      {
        type: 'actions',
        actions: [{ id: 'files', type: 'navigate', label: '文件', href: '/files' }],
      },
      { type: 'done', done: true },
    ]);
  });
});
