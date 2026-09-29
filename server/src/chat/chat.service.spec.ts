import { DocumentsService, type TraceableSearchResult } from '../documents/documents.service';
import type { ChatMessage } from './llm.service';
import { ChatService, type ChatStreamEvent } from './chat.service';
import { RagGraphService } from './rag/rag-graph.service';

const source = (index: number): TraceableSearchResult => ({
  chunkId: `chunk-${index}`,
  documentId: `doc-${index}`,
  title: `文档 ${index}`,
  sourcePath: `uploads/doc-${index}.md`,
  headingPath: ['一级标题', `二级标题 ${index}`],
  chunkIndex: index,
  content: `这是第 ${index} 个资料片段。`,
  similarity: 0.9 - index * 0.1,
});

async function collect(events: AsyncIterable<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const result: ChatStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

type JudgeResult = { relevance: 'relevant' | 'irrelevant'; reason?: string } | Error;

function createService(options: {
  sources?: TraceableSearchResult[];
  searchResults?: Array<TraceableSearchResult[] | Error>;
  searchError?: Error;
  judgeResults?: JudgeResult[];
  rewriteResults?: Array<string | Error>;
  llmError?: Error;
}) {
  // 按调用顺序返回；如果队列耗尽，就使用最后一个默认值，避免测试互相依赖。
  const searchQueue = [...(options.searchResults ?? [])];
  if (options.searchError) searchQueue.push(options.searchError);
  const judgeQueue = [...(options.judgeResults ?? [])];
  const rewriteQueue = [...(options.rewriteResults ?? [])];
  const defaultJudge: JudgeResult = options.sources?.length
    ? { relevance: 'relevant', reason: '资料足够' }
    : { relevance: 'irrelevant', reason: '资料不足' };

  const documentsService = {
    search:
      searchQueue.length > 0
        ? jest.fn(async () => {
            const next = searchQueue.shift();
            if (next instanceof Error) throw next;
            return next ?? options.sources ?? [];
          })
        : jest.fn().mockResolvedValue(options.sources ?? []),
  };

  const llmService = {
    judgeRelevance: jest.fn(async () => {
      const next = judgeQueue.shift();
      const value = next ?? defaultJudge;
      if (value instanceof Error) throw value;
      return { relevance: value.relevance, reason: value.reason ?? '' };
    }),
    rewriteQuery: jest.fn(async () => {
      const next = rewriteQueue.shift();
      if (next instanceof Error) throw next;
      return next ?? '重写后的检索查询';
    }),
    streamChat: jest.fn(function* (_messages: ChatMessage[]) {
      if (options.llmError) throw options.llmError;
      yield '第一段';
      yield '，第二段';
    }),
  };

  const ragGraphService = new RagGraphService(documentsService as never, llmService as never);
  const service = new ChatService(documentsService as never, llmService as never, ragGraphService);
  return { service, documentsService, llmService };
}

describe('ChatService D4 StateGraph', () => {
  it('首轮资料相关时只检索一次，直接生成', async () => {
    const sources = [source(1)];
    const { service, documentsService, llmService } = createService({ sources });

    const events = await collect(service.answerStream('pgvector 是什么', 'workspace-1', 5));

    expect(documentsService.search).toHaveBeenCalledTimes(1);
    expect(documentsService.search).toHaveBeenCalledWith('pgvector 是什么', 5, 'workspace-1');
    expect(llmService.judgeRelevance).toHaveBeenCalledTimes(1);
    expect(llmService.rewriteQuery).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: 'done', done: true });
  });

  it('首轮判为无关时重写一次，重写后相关则用最终来源生成', async () => {
    const firstSources = [source(1)];
    const finalSources = [source(2)];
    const { service, documentsService, llmService } = createService({
      searchResults: [firstSources, finalSources],
      judgeResults: [
        { relevance: 'irrelevant', reason: '片段只讲上传' },
        { relevance: 'relevant', reason: '片段直接回答' },
      ],
      rewriteResults: ['pgvector 用什么距离计算相似度'],
    });

    const events = await collect(service.answerStream('向量搜索怎么做', 'workspace-1', 3));

    expect(documentsService.search).toHaveBeenNthCalledWith(1, '向量搜索怎么做', 3, 'workspace-1');
    expect(documentsService.search).toHaveBeenNthCalledWith(
      2,
      'pgvector 用什么距离计算相似度',
      3,
      'workspace-1',
    );
    expect(llmService.rewriteQuery).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: 'sources', sources: finalSources },
      { type: 'delta', content: '第一段' },
      { type: 'delta', content: '，第二段' },
      { type: 'done', done: true },
    ]);
  });

  it('重写后仍无关时发送最终 sources 和兜底，不调用生成模型', async () => {
    const sources = [source(1)];
    const { service, llmService } = createService({
      sources,
      judgeResults: [
        { relevance: 'irrelevant', reason: '首轮无关' },
        { relevance: 'irrelevant', reason: '重写后仍无关' },
      ],
      rewriteResults: ['更好的问题'],
    });

    const events = await collect(service.answerStream('无关问题', 'workspace-1', 5));

    expect(events).toEqual([
      { type: 'sources', sources },
      {
        type: 'delta',
        content:
          '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。',
      },
      { type: 'done', done: true },
    ]);
    expect(llmService.judgeRelevance).toHaveBeenCalledTimes(2);
    expect(llmService.streamChat).not.toHaveBeenCalled();
  });

  it('judge 非法 JSON 时安全降级为 D3 行为：基于已有资料生成', async () => {
    const sources = [source(1)];
    const { service, llmService } = createService({
      sources,
      judgeResults: [new Error('相关性判断结果无法解析')],
    });

    const events = await collect(service.answerStream('问题', 'workspace-1', 5));

    expect(llmService.judgeRelevance).toHaveBeenCalledTimes(1);
    expect(llmService.rewriteQuery).not.toHaveBeenCalled();
    expect(events[0]).toEqual({ type: 'sources', sources });
    expect(events.at(-1)).toEqual({ type: 'done', done: true });
  });

  it('query 重写失败时耗尽预算，不再二次检索，直接兜底', async () => {
    const sources = [source(1)];
    const { service, documentsService, llmService } = createService({
      sources,
      judgeResults: [{ relevance: 'irrelevant', reason: '首轮无关' }],
      rewriteResults: [new Error('查询重写结果为空')],
    });

    const events = await collect(service.answerStream('问题', 'workspace-1', 5));

    expect(documentsService.search).toHaveBeenCalledTimes(1);
    expect(llmService.judgeRelevance).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: 'sources', sources },
      expect.objectContaining({ type: 'delta' }),
      { type: 'done', done: true },
    ]);
    expect(llmService.streamChat).not.toHaveBeenCalled();
  });

  it('final sources 数组顺序与生成 prompt 中的 [1]/[2] 顺序一致', async () => {
    const sources = [source(2), source(1)];
    const { service, llmService } = createService({ sources });

    await collect(service.answerStream('问题', 'workspace-1', 2));

    const messages = llmService.streamChat.mock.calls[0]?.[0] as ChatMessage[];
    const userPrompt = messages[1]?.content ?? '';
    expect(userPrompt.indexOf('[1]')).toBeLessThan(userPrompt.indexOf('[2]'));
    expect(userPrompt).toContain('标题：文档 2');
    expect(userPrompt).toContain('标题：文档 1');
  });

  it('生成失败时保留 sources，发送 error 且不发送 done', async () => {
    const { service } = createService({
      sources: [source(1)],
      llmError: new Error('模型服务鉴权失败'),
    });

    const events = await collect(service.answerStream('问题', 'workspace-1', 5));

    expect(events).toEqual([
      { type: 'sources', sources: [source(1)] },
      { type: 'error', message: '模型服务鉴权失败' },
    ]);
  });

  it('检索失败时只发送 error，不调用 judge 或生成模型', async () => {
    const { service, llmService } = createService({
      searchError: new Error('database unavailable'),
    });

    const events = await collect(service.answerStream('问题', 'workspace-1', 5));

    expect(events).toEqual([{ type: 'error', message: '知识库检索失败，请稍后重试' }]);
    expect(llmService.judgeRelevance).not.toHaveBeenCalled();
    expect(llmService.streamChat).not.toHaveBeenCalled();
  });

  it('Embedding 服务余额不足时返回明确的用户提示', async () => {
    const { service, llmService } = createService({
      searchError: Object.assign(new Error('Request failed with status code 402'), {
        response: { status: 402 },
      }),
    });

    const events = await collect(service.answerStream('问题', 'workspace-1', 5));

    expect(events).toEqual([
      { type: 'error', message: 'Embedding 服务余额不足，请充值或更换可用 API Key 后重试' },
    ]);
    expect(llmService.streamChat).not.toHaveBeenCalled();
  });

  it('workspaceId 为空时拒绝检索，实现最后一道隔离防线', async () => {
    const { service, documentsService, llmService } = createService({
      sources: [source(1)],
    });

    const events = await collect(service.answerStream('问题', '', 5));

    expect(events).toEqual([{ type: 'error', message: '知识库检索失败，请稍后重试' }]);
    expect(documentsService.search).not.toHaveBeenCalled();
    expect(llmService.judgeRelevance).not.toHaveBeenCalled();
    expect(llmService.streamChat).not.toHaveBeenCalled();
  });
});

describe('ChatService Nest DI metadata', () => {
  it('保留 DocumentsService class token，避免 type import 导致 Nest 启动失败', () => {
    const chatParamTypes = Reflect.getMetadata('design:paramtypes', ChatService) as unknown[];
    expect(chatParamTypes[0]).toBe(DocumentsService);

    const graphParamTypes = Reflect.getMetadata('design:paramtypes', RagGraphService) as unknown[];
    expect(graphParamTypes[0]).toBe(DocumentsService);
  });
});
