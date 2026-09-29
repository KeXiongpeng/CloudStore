import { Injectable } from '@nestjs/common';
import { getExpectedWorkspaceADocumentHashes, ragEvaluationSet } from './rag-eval-set';
import { AsyncEventQueue } from '../chat/rag/async-event-queue';
import type { ChatStreamEvent } from '../chat/chat.service';
import { NO_RELEVANT_SOURCE_FALLBACK } from '../chat/rag/rag-graph.factory';
import { RagGraphService } from '../chat/rag/rag-graph.service';
import type { RagGraphStateData } from '../chat/rag/rag-state';
import { PrismaService } from '../prisma/prisma.service';
import { calculateCaseMetrics, extractCitations } from './source-metrics';
import { RagAnswerJudgeService } from './rag-answer-judge.service';
import type {
  AnswerJudgeResult,
  EvaluatedCase,
  EvaluationPreflight,
  EvaluationRunOptions,
  EvaluationRunResult,
  RagCaseRawResult,
  RagEvaluationCase,
  RagEvaluationSet,
  RawCaseBehavior,
} from './evaluation.types';

export class EvaluationPreflightError extends Error {}

@Injectable()
export class RagEvaluationService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly ragGraphService: RagGraphService,
    private readonly answerJudgeService: RagAnswerJudgeService,
  ) {}

  async preflight(workspaceAId: string, workspaceBId: string): Promise<EvaluationPreflight> {
    const [workspaceA, workspaceB] = await Promise.all([
      this.prismaService.workspace.findFirst({
        where: { id: workspaceAId, status: 'active' },
        select: { id: true, name: true, status: true },
      }),
      this.prismaService.workspace.findFirst({
        where: { id: workspaceBId, status: 'active' },
        select: { id: true, name: true, status: true },
      }),
    ]);

    if (!workspaceA)
      throw new EvaluationPreflightError('评估预检失败：Workspace A 不存在或不是 active');
    if (!workspaceB)
      throw new EvaluationPreflightError('评估预检失败：Workspace B 不存在或不是 active');

    const documents = await this.prismaService.document.findMany({
      where: { workspaceId: workspaceAId },
      select: { id: true, title: true, contentHash: true, indexStatus: true },
      orderBy: { title: 'asc' },
    });

    const actualTitles = documents.map((document) => document.title).sort();
    const expectedTitles = [...ragEvaluationSet.expectedWorkspaceADocTitles].sort();
    if (
      actualTitles.length !== expectedTitles.length ||
      actualTitles.some((title, index) => title !== expectedTitles[index])
    ) {
      throw new EvaluationPreflightError(
        `评估语料预检失败：Workspace A 必须只包含 ${expectedTitles.join(', ')}`,
      );
    }

    const expectedDocumentHashes = getExpectedWorkspaceADocumentHashes();
    for (const document of documents) {
      if (document.indexStatus !== 'indexed') {
        throw new EvaluationPreflightError(`评估语料预检失败：${document.title} 状态不是 indexed`);
      }
      if (document.contentHash !== expectedDocumentHashes[document.title]) {
        throw new EvaluationPreflightError(
          `评估语料预检失败：${document.title} contentHash 与冻结语料不一致`,
        );
      }
    }

    const workspaceBDocumentCount = await this.prismaService.document.count({
      where: { workspaceId: workspaceBId },
    });
    if (workspaceBDocumentCount !== 0) {
      throw new EvaluationPreflightError('评估预检失败：Workspace B 必须是空知识库');
    }

    return {
      workspaceA,
      workspaceB,
      workspaceADocuments: documents,
      workspaceBDocumentCount,
    };
  }

  async evaluateCase(
    evaluationCase: RagEvaluationCase,
    workspaceId: string,
  ): Promise<EvaluatedCase> {
    const raw = await this.executeRaw(evaluationCase, workspaceId);
    const judge = await this.judgeRaw(evaluationCase, raw);
    const metrics = calculateCaseMetrics({
      evaluationCase,
      behavior: raw.behavior,
      sources: raw.sources,
      answer: raw.answer,
      answerCorrectness: judge.score,
      hallucination: judge.hallucination,
      workspaceLabel: evaluationCase.workspace,
    });

    return {
      ...raw,
      workspace: evaluationCase.workspace,
      expected: evaluationCase.expected,
      metrics,
      judge,
      failureReasons: this.buildFailureReasons(evaluationCase, raw, judge, metrics),
    };
  }

  async run(
    evaluationSet: RagEvaluationSet,
    options: EvaluationRunOptions,
  ): Promise<EvaluationRunResult> {
    const startedAt = new Date().toISOString();
    const preflight = await this.preflight(options.workspaceAId, options.workspaceBId);
    const cases: EvaluatedCase[] = [];

    for (const [index, evaluationCase] of evaluationSet.cases.entries()) {
      const workspaceId =
        evaluationCase.workspace === 'A' ? options.workspaceAId : options.workspaceBId;
      cases.push(await this.evaluateCase(evaluationCase, workspaceId));

      if (options.caseDelayMs > 0 && index < evaluationSet.cases.length - 1) {
        await this.delay(options.caseDelayMs);
      }
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      preflight,
      cases,
    };
  }

  private async executeRaw(
    evaluationCase: RagEvaluationCase,
    workspaceId: string,
  ): Promise<RagCaseRawResult> {
    const initialState: RagGraphStateData = {
      originalQuestion: evaluationCase.question,
      currentQuery: evaluationCase.question,
      workspaceId,
      limit: evaluationCase.limit,
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      maxRewrites: 1,
      retrieveCount: 0,
      errorMessage: undefined,
      lastRewrittenQuery: undefined,
      answer: undefined,
      toolCall: undefined,
      fallbackKind: undefined,
    };

    const startedAt = performance.now();
    const queue = new AsyncEventQueue<ChatStreamEvent>();
    const runPromise = this.ragGraphService.run(initialState, queue);
    let answer = '';
    let sources: RagGraphStateData['sources'] = [];
    const eventOrder: string[] = [];
    let errorMessage: string | undefined;

    try {
      for await (const event of queue.stream()) {
        eventOrder.push(event.type);
        if (event.type === 'sources') {
          sources = event.sources;
        } else if (event.type === 'delta') {
          answer += event.content;
        } else if (event.type === 'error') {
          errorMessage = event.message;
        }
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : 'RAG 执行失败';
    }

    const finalState = await runPromise.catch(() => undefined);
    let behavior: RawCaseBehavior = errorMessage ? 'error' : 'answer';
    if (
      !errorMessage &&
      (finalState?.fallbackKind ||
        this.normalize(answer) === this.normalize(NO_RELEVANT_SOURCE_FALLBACK))
    ) {
      behavior = 'fallback';
    }

    return {
      id: evaluationCase.id,
      category: evaluationCase.category,
      question: evaluationCase.question,
      behavior,
      sources,
      answer,
      citations: extractCitations(answer),
      errorMessage,
      rewriteCount: finalState?.rewriteCount ?? 0,
      retrieveCount: finalState?.retrieveCount ?? 0,
      totalLatencyMs: Math.max(0.01, performance.now() - startedAt),
      eventOrder,
    };
  }

  private async judgeRaw(
    evaluationCase: RagEvaluationCase,
    raw: RagCaseRawResult,
  ): Promise<AnswerJudgeResult> {
    if (evaluationCase.expected.behavior !== 'answer' || raw.behavior !== 'answer') {
      return {
        score: null,
        missingPoints: [],
        hallucination: false,
        reason:
          evaluationCase.expected.behavior === 'fallback'
            ? '兜底题不进行 answer judge'
            : '非 answer 行为不评分',
      };
    }

    return this.answerJudgeService.judge({
      evaluationCase,
      sources: raw.sources,
      answer: raw.answer,
    });
  }

  private buildFailureReasons(
    evaluationCase: RagEvaluationCase,
    raw: RagCaseRawResult,
    judge: AnswerJudgeResult,
    metrics: EvaluatedCase['metrics'],
  ): string[] {
    const reasons: string[] = [];
    if (!metrics.behaviorCorrect)
      reasons.push(`behavior expected=${evaluationCase.expected.behavior} actual=${raw.behavior}`);
    if (metrics.workspaceLeak) reasons.push('workspaceLeak');
    if (raw.behavior === 'answer') {
      if (metrics.hitAt3 === false) reasons.push('retrievalHit@3=false');
      if (metrics.sourceCoverage !== null && metrics.sourceCoverage < 1)
        reasons.push(`sourceCoverage=${metrics.sourceCoverage}`);
      if (metrics.citationValid === false) reasons.push('citationInvalid');
      if (judge.judgeError) reasons.push(judge.judgeError);
      if (!judge.judgeError && judge.score !== 2) reasons.push(`answerScore=${judge.score}`);
      if (judge.hallucination) reasons.push('hallucination');
    }
    if (raw.behavior === 'fallback' && metrics.fallbackCorrect === false)
      reasons.push('fallbackTextOrCitation');
    if (raw.behavior === 'error' && raw.errorMessage) reasons.push(raw.errorMessage);
    return reasons;
  }

  private normalize(value: string): string {
    return value.trim().replace(/\s+/g, '');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
