import { type TraceableSearchResult } from '../documents/documents.service';
import {
  calculateCaseMetrics,
  calculateRetrievalMetrics,
  extractCitations,
} from './source-metrics';
import { type RagEvaluationCase } from './evaluation.types';

const source = (id: string, headingPath: string[]): TraceableSearchResult => ({
  chunkId: `chunk-${id}`,
  documentId: `doc-${id}`,
  title: headingPath[0] ?? id,
  sourcePath: `uploads/${id}.md`,
  headingPath,
  chunkIndex: 0,
  content: `${id} 内容`,
  similarity: 0.9,
});

const answerCase: RagEvaluationCase = {
  id: 'fact-001',
  category: 'single-source-fact',
  workspace: 'A',
  question: 'HNSW 的 M 参数是什么？',
  limit: 5,
  expected: {
    behavior: 'answer',
    expectedSourceHeadingPaths: [['HNSW 基础', '核心参数']],
    minSources: 1,
    maxSources: 3,
    requireCitation: true,
  },
};

const fallbackCase: RagEvaluationCase = {
  id: 'irrelevant-001',
  category: 'irrelevant',
  workspace: 'A',
  question: '无关问题',
  limit: 5,
  expected: {
    behavior: 'fallback',
    expectedSourceHeadingPaths: [],
    requireCitation: false,
  },
};

describe('evaluation source metrics', () => {
  it('calculates Hit@K, reciprocal rank, and source coverage', () => {
    const sources = [
      source('upload', ['上传索引', '状态']),
      source('hnsw', ['HNSW 基础', '核心参数']),
    ];
    const metrics = calculateRetrievalMetrics(sources, answerCase.expected);

    expect(metrics).toEqual({
      hitAt1: false,
      hitAt3: true,
      reciprocalRank: 0.5,
      sourceCoverage: 1,
    });
  });

  it('extracts citations and rejects out-of-range references', () => {
    expect(extractCitations('依据 [1] 和 [3]。')).toEqual([1, 3]);
    expect(extractCitations('没有引用')).toEqual([]);

    const citations = extractCitations('依据 [1] 和 [2]');
    expect(citations.every((citation) => citation >= 1 && citations.length <= 2)).toBe(true);
    expect(extractCitations('越界 [4]')).toEqual([4]);
  });

  it('passes a valid answer case only with source hit, coverage, valid citation, and score 2', () => {
    const metrics = calculateCaseMetrics({
      evaluationCase: answerCase,
      behavior: 'answer',
      sources: [source('hnsw', ['HNSW 基础', '核心参数'])],
      answer: 'M 是最大出边数 [1]。',
      answerCorrectness: 2,
    });

    expect(metrics.behaviorCorrect).toBe(true);
    expect(metrics.citationValid).toBe(true);
    expect(metrics.pass).toBe(true);
  });

  it('fails an answer case when the judge reports hallucination even with score 2', () => {
    const metrics = calculateCaseMetrics({
      evaluationCase: answerCase,
      behavior: 'answer',
      sources: [source('hnsw', ['核心参数 M 和 efConstruction'])],
      answer: 'M 是最大出边数 [1]。',
      answerCorrectness: 2,
      hallucination: true,
    });

    expect(metrics.pass).toBe(false);
  });
  it('marks partial multi-source coverage below one', () => {
    const multiExpected = {
      ...answerCase.expected,
      expectedSourceHeadingPaths: [['核心参数 M 和 efConstruction'], ['查询参数 efSearch']],
    };
    const multiCase = { ...answerCase, expected: multiExpected };
    const metrics = calculateCaseMetrics({
      evaluationCase: multiCase,
      behavior: 'answer',
      sources: [source('hnsw', ['核心参数 M 和 efConstruction'])],
      answer: 'M [1]。',
      answerCorrectness: 2,
      hallucination: false,
    });

    expect(metrics.sourceCoverage).toBe(0.5);
    expect(metrics.pass).toBe(false);
  });

  it('rejects answers without citations or with out-of-range citations', () => {
    const missing = calculateCaseMetrics({
      evaluationCase: answerCase,
      behavior: 'answer',
      sources: [source('hnsw', ['核心参数 M 和 efConstruction'])],
      answer: 'M 是最大出边数。',
      answerCorrectness: 2,
      hallucination: false,
    });
    expect(missing.citationValid).toBe(false);
    expect(missing.pass).toBe(false);

    const outOfRange = calculateCaseMetrics({
      evaluationCase: answerCase,
      behavior: 'answer',
      sources: [source('hnsw', ['核心参数 M 和 efConstruction'])],
      answer: 'M [2]。',
      answerCorrectness: 2,
      hallucination: false,
    });
    expect(outOfRange.citationValid).toBe(false);
    expect(outOfRange.pass).toBe(false);
  });

  it('excludes fallback cases from answer retrieval metrics', () => {
    const metrics = calculateRetrievalMetrics(
      [source('hnsw', ['核心参数'])],
      fallbackCase.expected,
    );
    expect(metrics).toEqual({
      hitAt1: false,
      hitAt3: false,
      reciprocalRank: null,
      sourceCoverage: null,
    });
  });
  it('marks a fallback correct only for exact fallback text and no citations', () => {
    const metrics = calculateCaseMetrics({
      evaluationCase: fallbackCase,
      behavior: 'fallback',
      sources: [source('similar', ['上传索引', '状态'])],
      answer:
        '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。',
      answerCorrectness: null,
    });

    expect(metrics.behaviorCorrect).toBe(true);
    expect(metrics.citationValid).toBe(true);
    expect(metrics.fallbackCorrect).toBe(true);
    expect(metrics.pass).toBe(true);
  });

  it('marks workspace B as leaking when any source is returned', () => {
    const metrics = calculateCaseMetrics({
      evaluationCase: fallbackCase,
      behavior: 'fallback',
      sources: [source('hnsw', ['HNSW 基础', '核心参数'])],
      answer:
        '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。',
      answerCorrectness: null,
      workspaceLabel: 'B-empty',
    });

    expect(metrics.workspaceLeak).toBe(true);
    expect(metrics.pass).toBe(false);
  });
});
