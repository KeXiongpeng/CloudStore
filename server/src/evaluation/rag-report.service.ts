import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type {
  EvaluatedCase,
  EvaluationEnvironment,
  EvaluationFreeze,
  EvaluationReport,
  EvaluationReportSummary,
  EvaluationRunResult,
  RagEvaluationSet,
} from './evaluation.types';

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function percentage(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

@Injectable()
export class RagReportService {
  build(input: {
    label: string;
    evaluationSet: RagEvaluationSet;
    run: EvaluationRunResult;
    environment: EvaluationEnvironment;
    freeze: EvaluationFreeze;
  }): EvaluationReport {
    const cases = input.run.cases;
    const answerResults = cases.filter((item) => item.expected.behavior === 'answer');
    const fallbackResults = cases.filter((item) => item.expected.behavior === 'fallback');
    const judgeScores = answerResults
      .map((item) => item.judge.score)
      .filter((score): score is 0 | 1 | 2 => score !== null);
    const slowest = [...cases].sort((a, b) => b.totalLatencyMs - a.totalLatencyMs)[0];

    const summary: EvaluationReportSummary = {
      totalCases: cases.length,
      answerCases: answerResults.length,
      fallbackCases: fallbackResults.length,
      errorCases: cases.filter((item) => item.behavior === 'error').length,
      passRate: average(cases.map((item) => (item.metrics.pass ? 1 : 0))),
      retrievalHitAt3: average(answerResults.map((item) => (item.metrics.hitAt3 ? 1 : 0))),
      mrr: average(answerResults.map((item) => item.metrics.reciprocalRank ?? 0)),
      sourceCoverage: average(answerResults.map((item) => item.metrics.sourceCoverage ?? 0)),
      answerScore: average(judgeScores),
      fallbackCorrectness: average(
        fallbackResults.map((item) => (item.metrics.fallbackCorrect ? 1 : 0)),
      ),
      workspaceLeakCount: cases.filter((item) => item.metrics.workspaceLeak).length,
      judgeErrorCount: answerResults.filter((item) => item.judge.judgeError).length,
      rewriteTriggerRate: average(answerResults.map((item) => (item.rewriteCount > 0 ? 1 : 0))),
      averageLatencyMs: Number(average(cases.map((item) => item.totalLatencyMs)).toFixed(2)),
      slowestCaseId: slowest?.id,
    };

    return {
      reportVersion: 'v1',
      label: input.label,
      generatedAt: new Date().toISOString(),
      evalSet: {
        version: input.evaluationSet.version,
        title: input.evaluationSet.title,
        caseCount: input.evaluationSet.cases.length,
      },
      environment: input.environment,
      freeze: input.freeze,
      run: input.run,
      summary,
      cases,
      nextOptimizationHypotheses: this.buildHypotheses(cases),
      limitations: [
        'Answer judge 与业务生成模型同源，可能存在 self-judge bias。',
        '检索命中依据固定 headingPath，不评估语义等价但标题不同的来源。',
        '延迟包含上游模型与网络波动，单次 baseline 不能推断稳定 P95。',
        'judge 解析失败的题目不进入答案平均分，但 pass=false。',
        'totalLatencyMs 只包含 RAG 图执行，不包含后续 answer judge 调用。',
        'rewriteTriggerRate 的分母是 expected behavior=answer 的题目。',
      ],
    };
  }

  async writeReports(
    report: EvaluationReport,
    outputDir: string,
  ): Promise<{ jsonPath: string; markdownPath: string }> {
    await mkdir(outputDir, { recursive: true });
    const stamp = report.generatedAt.replace(/[:.]/g, '-');
    const base = `${stamp}-${report.label}`;
    const jsonPath = join(outputDir, `${base}.json`);
    const markdownPath = join(outputDir, `${base}.md`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(markdownPath, this.renderMarkdown(report), 'utf8');
    return { jsonPath, markdownPath };
  }

  private buildHypotheses(cases: EvaluatedCase[]): string[] {
    const hypotheses: string[] = [];
    if (cases.some((item) => item.metrics.workspaceLeak)) {
      hypotheses.push('P0：Workspace B 出现 source，先检查检索隔离，而不是调 prompt。');
    }
    if (
      cases.some(
        (item) => item.expected.behavior === 'fallback' && item.metrics.fallbackCorrect === false,
      )
    ) {
      hypotheses.push('无关题兜底失败：优先检查业务 relevance judge 与 fallback 分支。');
    }
    if (
      cases.some(
        (item) =>
          item.expected.behavior === 'answer' &&
          item.metrics.sourceCoverage !== null &&
          item.metrics.sourceCoverage < 1,
      )
    ) {
      hypotheses.push('多源覆盖不足：检查 Top K 排序、chunk 边界或 query rewrite。');
    }
    if (
      cases.some((item) => item.expected.behavior === 'answer' && item.metrics.hitAt3 === false)
    ) {
      hypotheses.push(
        'Hit@3 低：优先分析未命中题的 query 与期望 headingPath，不要直接换 embedding 模型。',
      );
    }
    if (
      cases.some(
        (item) => item.expected.behavior === 'answer' && item.metrics.citationValid === false,
      )
    ) {
      hypotheses.push('引用越界或缺失：检查 final sources 顺序与 citation prompt 约束。');
    }
    if (
      cases.some(
        (item) =>
          item.expected.behavior === 'answer' &&
          item.metrics.sourceCoverage === 1 &&
          item.judge.score !== null &&
          item.judge.score < 2,
      )
    ) {
      hypotheses.push('来源命中但答案不完整：检查上下文组装和生成 prompt。');
    }
    if (cases.some((item) => item.judge.judgeError)) {
      hypotheses.push('Answer judge 不稳定：先固化 JSON prompt/解析，再解释答案质量。');
    }
    if (hypotheses.length === 0) {
      hypotheses.push('当前没有明确失败模式；保持 baseline，不盲目优化。');
    }
    return hypotheses;
  }

  private renderMarkdown(report: EvaluationReport): string {
    const summary = report.summary;
    const failures = report.cases.filter((item) => !item.metrics.pass);
    const lines: string[] = [
      `# RAG Evaluation Report: ${report.label}`,
      '',
      '## Summary',
      '',
      `- Generated At: ${report.generatedAt}`,
      `- Eval Set: ${report.evalSet.version} (${report.evalSet.caseCount} cases)`,
      `- Pass Rate: ${percentage(summary.passRate)} (${Math.round(summary.passRate * summary.totalCases)}/${summary.totalCases})`,
      `- Answer Cases: ${summary.answerCases}`,
      `- Retrieval Hit@3: ${percentage(summary.retrievalHitAt3)}`,
      `- MRR: ${summary.mrr.toFixed(3)}`,
      `- Source Coverage: ${percentage(summary.sourceCoverage)}`,
      `- Answer Score: ${summary.answerScore.toFixed(2)} / 2`,
      `- Fallback Correctness: ${percentage(summary.fallbackCorrectness)}`,
      `- Workspace Leak: ${summary.workspaceLeakCount}`,
      `- Rewrite Trigger Rate: ${percentage(summary.rewriteTriggerRate)}`,
      `- Average Latency: ${summary.averageLatencyMs.toFixed(2)} ms`,
      `- Slowest Case: ${summary.slowestCaseId ?? 'N/A'}`,
      '',
      '## Baseline Freeze',
      '',
      `- Git Head: ${report.freeze.gitHead}`,
      `- Git Dirty: ${report.freeze.gitDirty}`,
      `- Backend Tests: ${report.freeze.backendTests}`,
      `- Frontend Tests: ${report.freeze.frontendTests}`,
      `- Node: ${report.environment.nodeVersion}`,
      `- LLM Model: ${report.environment.llmModel}`,
      `- Embedding Model: ${report.environment.embeddingModel}`,
      `- Workspace A: ${report.run.preflight.workspaceA.name} (${report.run.preflight.workspaceA.id})`,
      `- Workspace B: ${report.run.preflight.workspaceB.name} (${report.run.preflight.workspaceB.id}; documents=${report.run.preflight.workspaceBDocumentCount})`,
      '',
      '### Workspace A Documents',
      '',
      '| Title | Status | Content Hash |',
      '|---|---|---|',
      ...report.run.preflight.workspaceADocuments.map(
        (document) =>
          `| ${markdownCell(document.title)} | ${document.indexStatus} | ${document.contentHash} |`,
      ),
      '',
      '## Failure Summary',
      '',
      '| Case | Category | Failure Reason | Actual Behavior |',
      '|---|---|---|---|',
      ...(failures.length === 0
        ? ['| N/A | N/A | N/A | N/A |']
        : failures.map(
            (item) =>
              `| ${item.id} | ${item.category} | ${markdownCell(item.failureReasons.join('; ') || 'pass=false')} | ${item.behavior} |`,
          )),
      '',
      '## Per-case Result',
      '',
      '| ID | Question | Expected | Actual | Hit@3 | Score | Citation | Hallucination | Latency | Pass |',
      '|---|---|---|---|---|---|---|---|---:|---|',
      ...report.cases.map((item) =>
        [
          item.id,
          markdownCell(item.question),
          item.expected.behavior,
          item.behavior,
          item.expected.behavior === 'answer' ? String(item.metrics.hitAt3) : 'N/A',
          item.judge.score === null ? 'N/A' : String(item.judge.score),
          item.metrics.citationValid === null ? 'N/A' : String(item.metrics.citationValid),
          String(item.metrics.hallucination),
          item.totalLatencyMs.toFixed(2),
          String(item.metrics.pass),
        ]
          .join('|')
          .replace(/^/, '|')
          .concat('|'),
      ),
      '',
      '## Next Optimization Hypothesis',
      '',
      ...report.nextOptimizationHypotheses.map(
        (hypothesis, index) => `${index + 1}. ${hypothesis}`,
      ),
      '',
      '## Limitations',
      '',
      ...report.limitations.map((limitation, index) => `${index + 1}. ${limitation}`),
      '',
    ];
    return lines.join('\n');
  }
}
