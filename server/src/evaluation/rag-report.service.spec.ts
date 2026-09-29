import { mkdtemp, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseCliOptions } from './rag-evaluation.cli';
import { RagReportService } from './rag-report.service';
import { ragEvaluationSet } from './rag-eval-set';
import type { EvaluatedCase, RagEvaluationCase } from './evaluation.types';

const source = {
  chunkId: 'chunk',
  documentId: 'doc',
  title: 'doc.md',
  sourcePath: 'workspace-file:doc',
  headingPath: ['HNSW 基础', '核心参数'],
  chunkIndex: 0,
  content: 'M 是最大出边数。',
  similarity: 0.9,
};

const answerCase = ragEvaluationSet.cases[0]!;
const fallbackCase = ragEvaluationSet.cases.find((item) => item.id === 'irrelevant-001')!;
const isolationCase = ragEvaluationSet.cases.find((item) => item.id === 'isolation-001')!;

function evaluatedCase(overrides: {
  evaluationCase: RagEvaluationCase;
  behavior: EvaluatedCase['behavior'];
  sources?: EvaluatedCase['sources'];
  answer?: string;
  score?: 0 | 1 | 2 | null;
  pass?: boolean;
  workspaceLeak?: boolean;
}): EvaluatedCase {
  const answer = overrides.answer ?? '';
  return {
    id: overrides.evaluationCase.id,
    category: overrides.evaluationCase.category,
    workspace: overrides.evaluationCase.workspace,
    question: overrides.evaluationCase.question,
    behavior: overrides.behavior,
    sources: overrides.sources ?? [],
    answer,
    citations: [1],
    rewriteCount: 0,
    retrieveCount: 1,
    totalLatencyMs: 100,
    eventOrder: ['sources', 'delta', 'done'],
    expected: overrides.evaluationCase.expected,
    metrics: {
      hitAt1: true,
      hitAt3: true,
      reciprocalRank: 1,
      sourceCoverage: 1,
      behaviorCorrect: overrides.behavior !== 'error',
      answerCorrectness: overrides.score ?? null,
      citationValid: true,
      fallbackCorrect: overrides.behavior === 'fallback' && overrides.pass !== false,
      hallucination: false,
      workspaceLeak: overrides.workspaceLeak ?? false,
      pass: overrides.pass ?? true,
    },
    judge: {
      score: overrides.score ?? null,
      missingPoints: [],
      hallucination: false,
      reason: '',
    },
    failureReasons: [],
  };
}

describe('RagReportService', () => {
  it('aggregates answer, fallback, rewrite, latency, and isolation metrics', () => {
    const service = new RagReportService();
    const report = service.build({
      label: 'rag-baseline',
      evaluationSet: ragEvaluationSet,
      run: {
        startedAt: '2026-09-28T00:00:00.000Z',
        finishedAt: '2026-09-28T00:01:00.000Z',
        preflight: {
          workspaceA: { id: 'a', name: 'A', status: 'active' },
          workspaceB: { id: 'b', name: 'B', status: 'active' },
          workspaceADocuments: [
            { id: 'doc', title: '01-hnsw.md', contentHash: 'hash', indexStatus: 'indexed' },
          ],
          workspaceBDocumentCount: 0,
        },
        cases: [
          evaluatedCase({
            evaluationCase: answerCase,
            behavior: 'answer',
            sources: [source],
            answer: 'M [1]',
            score: 2,
          }),
          evaluatedCase({
            evaluationCase: fallbackCase,
            behavior: 'fallback',
            answer:
              '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。',
            pass: true,
          }),
          {
            ...evaluatedCase({
              evaluationCase: isolationCase,
              behavior: 'fallback',
              sources: [source],
              answer:
                '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。',
              pass: false,
              workspaceLeak: true,
            }),
            metrics: {
              hitAt1: false,
              hitAt3: false,
              reciprocalRank: null,
              sourceCoverage: null,
              behaviorCorrect: true,
              answerCorrectness: null,
              citationValid: false,
              fallbackCorrect: false,
              hallucination: false,
              workspaceLeak: true,
              pass: false,
            },
          },
        ],
      },
      environment: {
        nodeVersion: 'test-node',
        llmModel: 'test-model',
        embeddingModel: 'test-embedding',
      },
      freeze: {
        gitHead: 'head',
        gitDirty: true,
        backendTests: '122 passed',
        frontendTests: '28 passed',
      },
    });

    expect(report.summary.totalCases).toBe(3);
    expect(report.summary.answerCases).toBe(1);
    expect(report.summary.fallbackCases).toBe(2);
    expect(report.summary.passRate).toBeCloseTo(2 / 3);
    expect(report.summary.retrievalHitAt3).toBe(1);
    expect(report.summary.mrr).toBe(1);
    expect(report.summary.fallbackCorrectness).toBe(0.5);
    expect(report.summary.workspaceLeakCount).toBe(1);
    expect(report.nextOptimizationHypotheses[0]).toContain('P0：Workspace B');
    expect(report.nextOptimizationHypotheses.join('\n')).not.toContain('引用越界');
  });

  it('writes JSON and Markdown reports', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'rag-eval-'));
    const service = new RagReportService();
    const report = service.build({
      label: 'rag-baseline',
      evaluationSet: ragEvaluationSet,
      run: {
        startedAt: '2026-09-28T00:00:00.000Z',
        finishedAt: '2026-09-28T00:01:00.000Z',
        preflight: {
          workspaceA: { id: 'a', name: 'A', status: 'active' },
          workspaceB: { id: 'b', name: 'B', status: 'active' },
          workspaceADocuments: [],
          workspaceBDocumentCount: 0,
        },
        cases: [],
      },
      environment: {
        nodeVersion: 'test-node',
        llmModel: 'test-model',
        embeddingModel: 'test-embedding',
      },
      freeze: { gitHead: 'head', gitDirty: true, backendTests: '', frontendTests: '' },
    });

    const paths = await service.writeReports(report, outputDir);
    const json = JSON.parse(await readFile(paths.jsonPath, 'utf8'));
    const markdown = await readFile(paths.markdownPath, 'utf8');

    expect(json.label).toBe('rag-baseline');
    expect(markdown).toContain('# RAG Evaluation Report: rag-baseline');
    expect(markdown).toContain('## Summary');
    expect(markdown).toContain('## Failure Summary');
    expect(markdown).toContain('## Per-case Result');
    expect(markdown).toContain('## Next Optimization Hypothesis');
    expect(markdown).toContain('## Limitations');
  });
});

describe('evaluation CLI options', () => {
  it('parses required workspace IDs and safe label', () => {
    const options = parseCliOptions([
      '--label',
      'rag-baseline',
      '--workspace-a',
      '00000000-0000-4000-8000-00000000000a',
      '--workspace-b',
      '00000000-0000-4000-8000-00000000000b',
      '--case-delay-ms',
      '100',
    ]);
    expect(options).toMatchObject({
      label: 'rag-baseline',
      workspaceAId: '00000000-0000-4000-8000-00000000000a',
      workspaceBId: '00000000-0000-4000-8000-00000000000b',
      caseDelayMs: 100,
    });
  });

  it('rejects path traversal in label and missing workspace ID', () => {
    expect(() => parseCliOptions(['--label', '../bad'])).toThrow(
      '--label 只允许小写字母、数字和 -',
    );
    expect(() => parseCliOptions([])).toThrow('必须提供 --workspace-a');
  });
});
