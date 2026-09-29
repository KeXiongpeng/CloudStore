import { createRagGraph } from './rag-graph.factory';

const source = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  title: 'SEO 审计报告',
  sourcePath: 'uploads/seo.md',
  headingPath: ['问题清单'],
  chunkIndex: 0,
  content: 'Critical: 2；High: 3；Medium: 5。',
  similarity: 0.91,
};

const history = [
  { role: 'user' as const, content: '我的网站 SEO 数据怎么样。' },
  { role: 'assistant' as const, content: 'SEO 健康评分 42/100，审计报告列出了问题清单。' },
];

function createDeps(options: {
  sources?: unknown[] | Error[];
  condenseQuery?: string;
  plan?: unknown;
  stats?: Record<string, unknown>;
  streamError?: Error;
}) {
  const documentsService = {
    search: jest.fn(async () => {
      const value = options.sources?.[0];
      if (value instanceof Error) throw value;
      return options.sources as unknown[];
    }),
  };
  const llmService = {
    condenseQuestion: jest.fn().mockResolvedValue(options.condenseQuery ?? 'condensed query'),
    planSearchTool: jest.fn().mockResolvedValue(
      options.plan ?? {
        action: 'search',
        query: options.condenseQuery ?? 'condensed query',
        limit: 5,
      },
    ),
    judgeRelevance: jest.fn().mockResolvedValue({ relevance: 'irrelevant', reason: '不足' }),
    streamChat: jest.fn(function* () {
      if (options.streamError) throw options.streamError;
      yield '回答';
    }),
  };
  const knowledgeService = { getStats: jest.fn().mockResolvedValue(options.stats ?? {}) };
  const onEvent = jest.fn();
  const graph = createRagGraph({
    documentsService: documentsService as never,
    llmService: llmService as never,
    knowledgeService: knowledgeService as never,
    onEvent,
  });
  return { graph, documentsService, llmService, knowledgeService, onEvent };
}

describe('D7 RAG graph', () => {
  it('condenses follow-up before tool planning and search', async () => {
    const deps = createDeps({ condenseQuery: 'SEO 审计报告中有多少个问题？', sources: [source] });
    deps.llmService.judgeRelevance.mockResolvedValue({ relevance: 'relevant', reason: '足够' });

    await deps.graph.invoke({
      originalQuestion: '有多少问题',
      currentQuery: '有多少问题',
      workspaceId: 'workspace-1',
      limit: 5,
      history,
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      maxRewrites: 1,
      retrieveCount: 0,
    });

    expect(deps.llmService.condenseQuestion).toHaveBeenCalledWith(history, '有多少问题');
    expect(deps.llmService.planSearchTool).toHaveBeenCalledWith('有多少问题', history);
    expect(deps.documentsService.search).toHaveBeenCalledWith(
      'SEO 审计报告中有多少个问题？',
      5,
      'workspace-1',
    );
    expect(deps.llmService.judgeRelevance).toHaveBeenCalledWith(
      '有多少问题',
      [source],
      '用户: 我的网站 SEO 数据怎么样。\n助手: SEO 健康评分 42/100，审计报告列出了问题清单。',
    );
    const prompts = (
      deps.llmService.streamChat.mock.calls as unknown as Array<[Array<{ content: string }>]>
    ).flatMap((call) => call[0].map((message) => message.content));
    expect(prompts.join('\n')).toContain('SEO 审计报告中有多少个问题？');
    expect(prompts.join('\n')).toContain('SEO 健康评分');
  });

  it('uses the original question when tool arguments are invalid', async () => {
    const deps = createDeps({
      plan: { action: 'search', query: '', limit: 99 },
      sources: [source],
    });

    await deps.graph.invoke({
      originalQuestion: '有多少问题',
      currentQuery: '有多少问题',
      workspaceId: 'workspace-1',
      limit: 5,
      history,
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      maxRewrites: 1,
      retrieveCount: 0,
    });

    expect(deps.documentsService.search).toHaveBeenCalledWith('有多少问题', 5, 'workspace-1');
  });

  it('builds upload guidance when no indexable file exists', async () => {
    const deps = createDeps({
      sources: [],
      stats: {
        totalFiles: 2,
        indexableFiles: 0,
        indexed: 0,
        processing: 0,
        pending: 0,
        failed: 0,
        unsupported: 2,
        lastIndexedAt: null,
      },
    });

    await deps.graph.invoke({
      originalQuestion: '合同金额是多少',
      currentQuery: '合同金额是多少',
      workspaceId: 'workspace-1',
      limit: 5,
      history: [],
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      maxRewrites: 1,
      retrieveCount: 0,
    });

    const types = deps.onEvent.mock.calls.map(([event]) => event.type);
    expect(types).toEqual(['sources', 'actions', 'delta', 'done']);
    const actions = deps.onEvent.mock.calls[1][0].actions;
    expect(actions).toEqual([
      expect.objectContaining({
        type: 'navigate',
        label: '上传知识库文件',
        href: '/files?upload=1',
      }),
      expect.objectContaining({ type: 'navigate', label: '查看文件管理', href: '/files' }),
    ]);
    expect(JSON.stringify(deps.onEvent.mock.calls)).not.toContain('workspace-1');
  });

  it('distinguishes weak sources and offers source review plus upload', async () => {
    const deps = createDeps({
      sources: [source],
      stats: {
        totalFiles: 1,
        indexableFiles: 1,
        indexed: 1,
        processing: 0,
        pending: 0,
        failed: 0,
        unsupported: 0,
        lastIndexedAt: new Date('2026-09-29T00:00:00.000Z'),
      },
    });

    await deps.graph.invoke({
      originalQuestion: '有多少问题',
      currentQuery: '有多少问题',
      workspaceId: 'workspace-1',
      limit: 5,
      history,
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      maxRewrites: 1,
      retrieveCount: 0,
    });

    const actions = deps.onEvent.mock.calls[1][0].actions;
    expect(actions.map((action: { type: string }) => action.type)).toEqual([
      'openSources',
      'navigate',
    ]);
    expect(deps.onEvent.mock.calls[2][0].content).toContain('相关片段');
    expect(deps.onEvent.mock.calls[2][0].content).toContain('不足以完整回答');
  });
});
