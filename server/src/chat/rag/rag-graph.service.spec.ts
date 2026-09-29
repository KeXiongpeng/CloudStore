import { AsyncEventQueue } from './async-event-queue';
import { RagGraphService } from './rag-graph.service';
import { type RagGraphState } from './rag-state';
import { type TraceableSearchResult } from '../../documents/documents.service';
import type { ChatMessage } from '../llm.service';
import type { ChatStreamEvent } from '../chat.service';

const source: TraceableSearchResult = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  title: '文档',
  sourcePath: 'uploads/doc.md',
  headingPath: ['标题'],
  chunkIndex: 0,
  content: '资料内容',
  similarity: 0.9,
};

function createDependencies(options: {
  searchResults?: TraceableSearchResult[][];
  judgeResults?: Array<{ relevance: 'relevant' | 'irrelevant'; reason: string }>;
}) {
  const searchQueue = [...(options.searchResults ?? [[source]])];
  const judgeQueue = [
    ...(options.judgeResults ?? [{ relevance: 'relevant' as const, reason: '足够' }]),
  ];
  return {
    documentsService: {
      search: jest.fn(async () => searchQueue.shift() ?? []),
    },
    llmService: {
      judgeRelevance: jest.fn(
        async () => judgeQueue.shift() ?? { relevance: 'relevant' as const, reason: '' },
      ),
      rewriteQuery: jest.fn(async () => '重写后的查询'),
      streamChat: jest.fn(async function* (_messages: ChatMessage[]): AsyncGenerator<string> {
        yield '回答';
      }),
    },
  };
}

async function collect(queue: AsyncEventQueue<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of queue.stream()) events.push(event);
  return events;
}

describe('RagGraphService final state telemetry', () => {
  it('returns final state and one retrieval count for a normal run', async () => {
    const dependencies = createDependencies({});
    const service = new RagGraphService(
      dependencies.documentsService as never,
      dependencies.llmService as never,
    );
    const queue = new AsyncEventQueue<ChatStreamEvent>();
    const initialState: RagGraphState = {
      originalQuestion: '问题',
      currentQuery: '问题',
      workspaceId: 'workspace-1',
      limit: 5,
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      maxRewrites: 1,
      retrieveCount: 0,
      errorMessage: undefined,
      lastRewrittenQuery: undefined,
      answer: undefined,
    };

    const runPromise = service.run(initialState, queue);
    await collect(queue);
    const finalState = await runPromise;

    expect(dependencies.documentsService.search).toHaveBeenCalledTimes(1);
    expect(finalState).toBeDefined();
    expect(finalState?.retrieveCount).toBe(1);
    expect(finalState?.answer).toBe('回答');
  });

  it('returns two retrieval counts after one successful rewrite', async () => {
    const dependencies = createDependencies({
      searchResults: [[], [source]],
      judgeResults: [
        { relevance: 'irrelevant', reason: '第一轮不足' },
        { relevance: 'relevant', reason: '第二轮足够' },
      ],
    });
    const service = new RagGraphService(
      dependencies.documentsService as never,
      dependencies.llmService as never,
    );
    const queue = new AsyncEventQueue<ChatStreamEvent>();
    const initialState: RagGraphState = {
      originalQuestion: '口语化问题',
      currentQuery: '口语化问题',
      workspaceId: 'workspace-1',
      limit: 5,
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      maxRewrites: 1,
      retrieveCount: 0,
      errorMessage: undefined,
      lastRewrittenQuery: undefined,
      answer: undefined,
    };

    const runPromise = service.run(initialState, queue);
    await collect(queue);
    const finalState = await runPromise;

    expect(dependencies.documentsService.search).toHaveBeenCalledTimes(2);
    expect(finalState).toBeDefined();
    expect(finalState?.rewriteCount).toBe(1);
    expect(finalState?.retrieveCount).toBe(2);
  });
});
