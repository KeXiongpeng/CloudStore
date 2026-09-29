import type { TraceableSearchResult } from '../documents/documents.service';

export type EvaluationBehavior = 'answer' | 'fallback';
export type RawCaseBehavior = EvaluationBehavior | 'error';
export type EvaluationWorkspace = 'A' | 'B-empty';

export interface ExpectedKeyFact {
  /** 人工审题后的语义要点；answer judge 判断回答是否覆盖它。 */
  point: string;
  /** 语义要点的稳定锚点；写报告和 judge prompt 时都使用这一组值。 */
  anchors?: string[];
}

export interface RagEvaluationExpected {
  behavior: EvaluationBehavior;
  mustMention?: ExpectedKeyFact[];
  expectedSourceHeadingPaths: string[][];
  minSources?: number;
  maxSources?: number;
  requireCitation: boolean;
}

export interface RagEvaluationCase {
  id: string;
  category:
    'single-source-fact' | 'multi-source' | 'colloquial' | 'irrelevant' | 'workspace-isolation';
  workspace: EvaluationWorkspace;
  question: string;
  limit: number;
  expected: RagEvaluationExpected;
}

export interface RagEvaluationSet {
  version: 'v1';
  title: string;
  expectedWorkspaceADocTitles: string[];
  workspaceBMustBeEmpty: true;
  cases: RagEvaluationCase[];
}

export interface RagCaseRawResult {
  id: string;
  category: RagEvaluationCase['category'];
  question: string;
  behavior: RawCaseBehavior;
  sources: TraceableSearchResult[];
  answer: string;
  citations: number[];
  errorMessage?: string;
  rewriteCount: number;
  retrieveCount: number;
  totalLatencyMs: number;
  eventOrder: string[];
}

export interface RetrievalMetrics {
  hitAt1: boolean;
  hitAt3: boolean;
  reciprocalRank: number | null;
  sourceCoverage: number | null;
}

export interface CaseMetrics extends RetrievalMetrics {
  behaviorCorrect: boolean;
  answerCorrectness: number | null;
  citationValid: boolean | null;
  fallbackCorrect: boolean | null;
  hallucination: boolean;
  workspaceLeak: boolean;
  pass: boolean;
}

export interface AnswerJudgeResult {
  score: 0 | 1 | 2 | null;
  missingPoints: string[];
  hallucination: boolean;
  reason: string;
  judgeError?: string;
}

export interface EvaluatedCase extends RagCaseRawResult {
  workspace: EvaluationWorkspace;
  expected: RagEvaluationExpected;
  metrics: CaseMetrics;
  judge: AnswerJudgeResult;
  failureReasons: string[];
}

export interface EvaluationPreflightDocument {
  id: string;
  title: string;
  contentHash: string;
  indexStatus: string;
}

export interface EvaluationPreflight {
  workspaceA: { id: string; name: string; status: string };
  workspaceB: { id: string; name: string; status: string };
  workspaceADocuments: EvaluationPreflightDocument[];
  workspaceBDocumentCount: number;
}

export interface EvaluationRunOptions {
  workspaceAId: string;
  workspaceBId: string;
  caseDelayMs: number;
}

export interface EvaluationRunResult {
  startedAt: string;
  finishedAt: string;
  preflight: EvaluationPreflight;
  cases: EvaluatedCase[];
}

export interface EvaluationEnvironment {
  nodeVersion: string;
  llmModel: string;
  embeddingModel: string;
  llmTemperature?: number;
  llmMaxTokens?: number;
}

export interface EvaluationFreeze {
  gitHead: string;
  gitDirty: boolean;
  backendTests: string;
  frontendTests: string;
}

export interface EvaluationReportSummary {
  totalCases: number;
  answerCases: number;
  fallbackCases: number;
  errorCases: number;
  passRate: number;
  retrievalHitAt3: number;
  mrr: number;
  sourceCoverage: number;
  answerScore: number;
  fallbackCorrectness: number;
  workspaceLeakCount: number;
  judgeErrorCount: number;
  rewriteTriggerRate: number;
  averageLatencyMs: number;
  slowestCaseId?: string;
}

export interface EvaluationReport {
  reportVersion: 'v1';
  label: string;
  generatedAt: string;
  evalSet: { version: string; title: string; caseCount: number };
  environment: EvaluationEnvironment;
  freeze: EvaluationFreeze;
  run: EvaluationRunResult;
  summary: EvaluationReportSummary;
  cases: EvaluatedCase[];
  nextOptimizationHypotheses: string[];
  limitations: string[];
}
