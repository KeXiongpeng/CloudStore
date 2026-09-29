import { NO_RELEVANT_SOURCE_FALLBACK } from '../chat/rag/rag-graph.factory';
import type { TraceableSearchResult } from '../documents/documents.service';
import type {
  CaseMetrics,
  RagEvaluationCase,
  RagEvaluationExpected,
  RawCaseBehavior,
  RetrievalMetrics,
} from './evaluation.types';

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function isSubsequence(expected: string[], actual: string[]): boolean {
  let cursor = 0;
  for (const expectedHeading of expected) {
    const expectedValue = normalizeText(expectedHeading);
    while (cursor < actual.length && normalizeText(actual[cursor] ?? '') !== expectedValue) {
      cursor += 1;
    }
    if (cursor >= actual.length) return false;
    cursor += 1;
  }
  return true;
}

export function matchesExpectedHeadingPath(
  actualHeadingPath: string[],
  expectedHeadingPath: string[],
): boolean {
  return isSubsequence(expectedHeadingPath, actualHeadingPath);
}

export function calculateRetrievalMetrics(
  sources: TraceableSearchResult[],
  expected: RagEvaluationExpected,
): RetrievalMetrics {
  if (expected.behavior !== 'answer' || expected.expectedSourceHeadingPaths.length === 0) {
    return { hitAt1: false, hitAt3: false, reciprocalRank: null, sourceCoverage: null };
  }

  let firstHitRank: number | null = null;
  const matchedGroups = new Set<number>();

  sources.forEach((source, index) => {
    expected.expectedSourceHeadingPaths.forEach((expectedPath, groupIndex) => {
      if (!matchesExpectedHeadingPath(source.headingPath ?? [], expectedPath)) return;
      matchedGroups.add(groupIndex);
      if (firstHitRank === null) firstHitRank = index + 1;
    });
  });

  return {
    hitAt1: firstHitRank === 1,
    hitAt3: firstHitRank !== null && firstHitRank <= 3,
    reciprocalRank: firstHitRank === null ? null : 1 / firstHitRank,
    sourceCoverage: matchedGroups.size / expected.expectedSourceHeadingPaths.length,
  };
}

export function extractCitations(answer: string): number[] {
  const citations: number[] = [];
  const pattern = /\[(\d+)\]/g;
  let match = pattern.exec(answer);
  while (match) {
    citations.push(Number(match[1]));
    match = pattern.exec(answer);
  }
  return citations;
}

function isWithinSourceCount(
  sources: TraceableSearchResult[],
  expected: RagEvaluationExpected,
): boolean {
  const min = expected.minSources ?? 0;
  const max = expected.maxSources ?? Number.MAX_SAFE_INTEGER;
  return sources.length >= min && sources.length <= max;
}

export function calculateCaseMetrics(input: {
  evaluationCase: RagEvaluationCase;
  behavior: RawCaseBehavior;
  sources: TraceableSearchResult[];
  answer: string;
  answerCorrectness: number | null;
  hallucination?: boolean;
  workspaceLabel?: RagEvaluationCase['workspace'];
}): CaseMetrics {
  const {
    evaluationCase,
    behavior,
    sources,
    answer,
    answerCorrectness,
    hallucination = false,
  } = input;
  const expected = evaluationCase.expected;
  const citations = extractCitations(answer);
  const retrieval = calculateRetrievalMetrics(sources, expected);
  const sourceCountCorrect = isWithinSourceCount(sources, expected);

  const behaviorCorrect = behavior === expected.behavior && sourceCountCorrect;

  const citationValid =
    behavior === 'error'
      ? null
      : expected.behavior === 'fallback'
        ? citations.length === 0
        : citations.length > 0 &&
          citations.every((citation) => citation >= 1 && citation <= sources.length);

  const normalizedAnswer = normalizeText(answer);
  const fallbackCorrect =
    expected.behavior === 'fallback'
      ? behavior === 'fallback' &&
        normalizedAnswer === normalizeText(NO_RELEVANT_SOURCE_FALLBACK) &&
        citations.length === 0
      : null;

  const workspaceLeak = input.workspaceLabel === 'B-empty' && sources.length > 0;

  const pass =
    behavior === 'answer'
      ? behaviorCorrect &&
        sourceCountCorrect &&
        retrieval.hitAt3 &&
        retrieval.sourceCoverage === 1 &&
        citationValid === true &&
        answerCorrectness === 2 &&
        !hallucination &&
        !workspaceLeak
      : behavior === 'fallback'
        ? behaviorCorrect &&
          sourceCountCorrect &&
          fallbackCorrect === true &&
          citationValid === true &&
          !workspaceLeak
        : false;

  return {
    ...retrieval,
    behaviorCorrect,
    answerCorrectness,
    citationValid,
    fallbackCorrect,
    hallucination,
    workspaceLeak,
    pass,
  };
}
