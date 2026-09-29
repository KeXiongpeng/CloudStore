import { AsyncEventQueue } from '../chat/rag/async-event-queue';
import type { ChatStreamEvent } from '../chat/chat.service';
import type { RagGraphState } from '../chat/rag/rag-state';
import type { RagGraphService } from '../chat/rag/rag-graph.service';
import type { TraceableSearchResult } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { RagAnswerJudgeService } from './rag-answer-judge.service';
import { RagEvaluationService } from './rag-evaluation.service';
import { getExpectedWorkspaceADocumentHashes, ragEvaluationSet } from './rag-eval-set';
import type { RagEvaluationCase } from './evaluation.types';

const source: TraceableSearchResult = {
  chunkId: 'chunk-1',
  documentId: 'doc-1',
  title: '01-hnsw.md',
  sourcePath: 'workspace-file:file-1',
  headingPath: ['HNSW 基础', '核心参数'],
  chunkIndex: 0,
  content: 'M 是最大出边数。',
  similarity: 0.92,
};

const answerCase = ragEvaluationSet.cases.find(
  (item) => item.id === 'fact-001',
) as RagEvaluationCase;
const irrelevantCase = ragEvaluationSet.cases.find(
  (item) => item.id === 'irrelevant-001',
) as RagEvaluationCase;

const expectedDocumentHashes = getExpectedWorkspaceADocumentHashes();

function createPrisma(options: {
  workspaceA?: object | null;
  workspaceB?: object | null;
  documents?: Array<
    Partial<{ title: string; indexStatus: string; contentHash: string; id: string }>
  >;
  emptyDocuments?: boolean;
}) {
  return {
    workspace: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'a-workspace'
          ? (options.workspaceA ?? { id: 'a-workspace', status: 'active' })
          : (options.workspaceB ?? { id: 'b-workspace', status: 'active' }),
      ),
    },
    document: {
      findMany: jest.fn(
        async () =>
          options.documents ??
          ragEvaluationSet.expectedWorkspaceADocTitles.map((title, index) => ({
            id: `doc-${index + 1}`,
            title,
            contentHash: expectedDocumentHashes[title] ?? `hash-${index + 1}`,
            indexStatus: 'indexed',
          })),
      ),
      count: jest.fn(async () => (options.emptyDocuments ? 0 : 0)),
    },
  };
}

function createState(): RagGraphState {
  return {
    originalQuestion: 'question',
    currentQuery: 'question',
    workspaceId: 'a-workspace',
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
}

function createGraphService(
  script: Array<
    (state: RagGraphState, queue: AsyncEventQueue<ChatStreamEvent>) => Promise<RagGraphState>
  >,
) {
  let call = 0;
  return {
    run: jest.fn(async (state: RagGraphState, queue: AsyncEventQueue<ChatStreamEvent>) => {
      const action = script[Math.min(call, script.length - 1)]!;
      call += 1;
      const finalState = await action(state, queue);
      queue.close();
      return finalState;
    }),
  };
}

function createJudge(score: 0 | 1 | 2 | null = 2) {
  return {
    judge: jest.fn(async () => ({
      score,
      missingPoints: score === 2 ? [] : ['关键点缺失'],
      hallucination: false,
      reason: score === 2 ? '正确' : '部分正确',
    })),
  };
}

describe('RagEvaluationService', () => {
  it('passes strict corpus preflight', async () => {
    const prisma = createPrisma({});
    const service = new RagEvaluationService(
      prisma as unknown as PrismaService,
      {} as RagGraphService,
      {} as RagAnswerJudgeService,
    );

    const preflight = await service.preflight('a-workspace', 'b-workspace');
    expect(preflight.workspaceA.id).toBe('a-workspace');
    expect(preflight.workspaceADocuments).toHaveLength(8);
    expect(preflight.workspaceBDocumentCount).toBe(0);
  });

  it('fails preflight when a corpus document is not indexed', async () => {
    const documents = ragEvaluationSet.expectedWorkspaceADocTitles.map((title, index) => ({
      id: `doc-${index + 1}`,
      title,
      contentHash: `hash-${index + 1}`,
      indexStatus: index === 0 ? 'failed' : 'indexed',
    }));
    const prisma = createPrisma({ documents });
    const service = new RagEvaluationService(
      prisma as unknown as PrismaService,
      {} as RagGraphService,
      {} as RagAnswerJudgeService,
    );

    await expect(service.preflight('a-workspace', 'b-workspace')).rejects.toThrow(
      '评估语料预检失败：01-hnsw.md 状态不是 indexed',
    );
  });

  it('fails preflight when an indexed document content hash drifts', async () => {
    const documents = ragEvaluationSet.expectedWorkspaceADocTitles.map((title, index) => ({
      id: `doc-${index + 1}`,
      title,
      contentHash:
        index === 1 ? 'drifted-hash' : (expectedDocumentHashes[title] ?? `hash-${index + 1}`),
      indexStatus: 'indexed',
    }));
    const prisma = createPrisma({ documents });
    const service = new RagEvaluationService(
      prisma as unknown as PrismaService,
      {} as RagGraphService,
      {} as RagAnswerJudgeService,
    );

    await expect(service.preflight('a-workspace', 'b-workspace')).rejects.toThrow(
      '评估语料预检失败：02-pgvector.md contentHash 与冻结语料不一致',
    );
  });
  it('collects answer events and answer judge result', async () => {
    const prisma = createPrisma({});
    const graphService = createGraphService([
      async (state, queue) => {
        const hitSource = {
          ...source,
          headingPath: answerCase.expected.expectedSourceHeadingPaths[0] ?? [],
        };
        queue.push({ type: 'sources', sources: [hitSource] });
        queue.push({ type: 'delta', content: 'M 是最大出边数 [1]。' });
        queue.push({ type: 'done', done: true });
        return { ...state, sources: [hitSource], answer: 'M 是最大出边数 [1]。', retrieveCount: 1 };
      },
    ]);
    const judge = createJudge(2);
    const service = new RagEvaluationService(
      prisma as unknown as PrismaService,
      graphService as unknown as RagGraphService,
      judge as unknown as RagAnswerJudgeService,
    );

    const result = await service.evaluateCase(answerCase, 'a-workspace');
    expect(result.behavior).toBe('answer');
    expect(result.answer).toBe('M 是最大出边数 [1]。');
    expect(result.citations).toEqual([1]);
    expect(result.retrieveCount).toBe(1);
    expect(result.totalLatencyMs).toBeGreaterThan(0);
    expect(result.eventOrder).toEqual(['sources', 'delta', 'done']);
    expect(result.judge.score).toBe(2);
    expect(result.metrics.pass).toBe(true);
  });

  it('recognizes exact fallback text and does not call answer judge', async () => {
    const prisma = createPrisma({});
    const fallbackText =
      '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。';
    const graphService = createGraphService([
      async (state, queue) => {
        queue.push({ type: 'sources', sources: [] });
        queue.push({ type: 'delta', content: fallbackText });
        queue.push({ type: 'done', done: true });
        return { ...state, answer: fallbackText, retrieveCount: 1 };
      },
    ]);
    const judge = createJudge();
    const service = new RagEvaluationService(
      prisma as unknown as PrismaService,
      graphService as unknown as RagGraphService,
      judge as unknown as RagAnswerJudgeService,
    );

    const result = await service.evaluateCase(irrelevantCase, 'a-workspace');
    expect(result.behavior).toBe('fallback');
    expect(result.judge.score).toBeNull();
    expect(result.metrics.fallbackCorrect).toBe(true);
    expect(judge.judge).not.toHaveBeenCalled();
  });

  it('continues after an error case', async () => {
    const prisma = createPrisma({});
    const fallbackText =
      '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。';
    const graphService = createGraphService([
      async (state, queue) => {
        queue.push({ type: 'error', message: '知识库检索失败' });
        return { ...state, errorMessage: '知识库检索失败' };
      },
      async (state, queue) => {
        queue.push({ type: 'sources', sources: [] });
        queue.push({ type: 'delta', content: fallbackText });
        queue.push({ type: 'done', done: true });
        return { ...state, answer: fallbackText, retrieveCount: 1 };
      },
    ]);
    const judge = createJudge(2);
    const service = new RagEvaluationService(
      prisma as unknown as PrismaService,
      graphService as unknown as RagGraphService,
      judge as unknown as RagAnswerJudgeService,
    );

    const results = [];
    for (const item of [answerCase, irrelevantCase]) {
      results.push(await service.evaluateCase(item, 'a-workspace'));
    }

    expect(results[0]?.behavior).toBe('error');
    expect(results[0]?.metrics.pass).toBe(false);
    expect(results[1]?.behavior).toBe('fallback');
    expect(graphService.run).toHaveBeenCalledTimes(2);
  });

  it('runs all cases sequentially with preflight and delay', async () => {
    const prisma = createPrisma({});
    const fallbackText =
      '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。';
    const graphService = createGraphService([
      async (state, queue) => {
        const hitSource = {
          ...source,
          headingPath: answerCase.expected.expectedSourceHeadingPaths[0] ?? [],
        };
        queue.push({ type: 'sources', sources: [hitSource] });
        queue.push({ type: 'delta', content: 'M 是最大出边数 [1]。' });
        queue.push({ type: 'done', done: true });
        return { ...state, sources: [hitSource], answer: 'M 是最大出边数 [1]。', retrieveCount: 1 };
      },
      async (state, queue) => {
        queue.push({ type: 'sources', sources: [] });
        queue.push({ type: 'delta', content: fallbackText });
        queue.push({ type: 'done', done: true });
        return { ...state, answer: fallbackText, retrieveCount: 1 };
      },
    ]);
    const judge = createJudge(2);
    const service = new RagEvaluationService(
      prisma as unknown as PrismaService,
      graphService as unknown as RagGraphService,
      judge as unknown as RagAnswerJudgeService,
    );
    const shortSet = { ...ragEvaluationSet, cases: [answerCase, irrelevantCase] };

    const result = await service.run(shortSet, {
      workspaceAId: 'a-workspace',
      workspaceBId: 'b-workspace',
      caseDelayMs: 0,
    });

    expect(result.preflight.workspaceADocuments).toHaveLength(8);
    expect(result.cases).toHaveLength(2);
    expect(graphService.run).toHaveBeenCalledTimes(2);
  });
});
