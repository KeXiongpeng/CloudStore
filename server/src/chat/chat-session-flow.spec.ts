import { ChatService, type ChatStreamEvent } from './chat.service';
import { RagGraphService } from './rag/rag-graph.service';
import { ChatSessionService } from './chat-session.service';

const source = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  title: 'SEO 审计报告',
  sourcePath: 'uploads/seo.md',
  headingPath: [],
  chunkIndex: 0,
  content: '共 10 个问题。',
  similarity: 0.92,
};

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const result: ChatStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function createService() {
  const documentsService = { search: jest.fn().mockResolvedValue([source]) };
  const llmService = {
    condenseQuestion: jest.fn().mockResolvedValue('SEO 审计报告中有多少个问题？'),
    planSearchTool: jest
      .fn()
      .mockResolvedValue({ action: 'search', query: 'SEO 审计报告中有多少个问题？', limit: 5 }),
    judgeRelevance: jest.fn().mockResolvedValue({ relevance: 'relevant', reason: '足够' }),
    rewriteQuery: jest.fn(),
    streamChat: jest.fn(function* () {
      yield '报告中有';
      yield ' 10 个问题。';
    }),
  };
  const ragGraphService = new RagGraphService(documentsService as never, llmService as never);
  const sessionService = {
    resolveForAsk: jest.fn().mockResolvedValue({ id: 'session-1', title: 'SEO' }),
    getHistory: jest.fn().mockResolvedValue([
      { role: 'user', content: '我的网站 SEO 数据怎么样。' },
      { role: 'assistant', content: 'SEO 健康评分 42/100。' },
    ]),
    saveUserMessage: jest.fn().mockResolvedValue(undefined),
    saveAssistantMessage: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ChatService(
    documentsService as never,
    llmService as never,
    ragGraphService,
    sessionService as never,
  );
  return { service, sessionService, documentsService, llmService };
}

describe('D7 ChatService session persistence', () => {
  it('without a client sessionId creates a server session but preserves legacy SSE events', async () => {
    const { service, sessionService } = createService();

    const events = await collect(
      service.answerStream('问题', 'workspace-1', 5, undefined, 'user-1'),
    );

    expect(sessionService.resolveForAsk).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', userId: 'user-1' }),
      undefined,
      '问题',
    );
    expect(events[0]).toEqual({ type: 'session', session: { id: 'session-1', title: 'SEO' } });
    expect(events.at(-1)).toEqual({ type: 'done', done: true });
  });

  it('emits session metadata, loads history, and persists both messages after done', async () => {
    const { service, sessionService } = createService();

    const events = await collect(
      service.answerStream('有多少问题', 'workspace-1', 5, 'session-existing', 'user-1'),
    );

    expect(sessionService.resolveForAsk).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'workspace-1', userId: 'user-1' }),
      'session-existing',
      '有多少问题',
    );
    expect(sessionService.getHistory).toHaveBeenCalledWith('session-1', 10);
    expect(sessionService.saveUserMessage).toHaveBeenCalledWith('session-1', '有多少问题');
    expect(sessionService.saveAssistantMessage).toHaveBeenCalledWith(
      'session-1',
      '报告中有 10 个问题。',
      [source],
    );
    expect(events[0]).toEqual({ type: 'session', session: { id: 'session-1', title: 'SEO' } });
    expect(events[1]?.type).toBe('sources');
    expect(events.at(-1)).toEqual({ type: 'done', done: true });
  });

  it('does not expose workspaceId to generation prompts', async () => {
    const { service, llmService } = createService();

    await collect(service.answerStream('问题', 'workspace-1', 5, 'session-existing', 'user-1'));

    const messages = (
      llmService.streamChat.mock.calls[0] as unknown as [Array<{ content: string }>]
    )[0];
    expect(JSON.stringify(messages)).not.toContain('workspace-1');
  });
});
