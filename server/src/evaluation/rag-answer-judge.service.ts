import { Injectable } from '@nestjs/common';
import { LlmService, type ChatMessage } from '../chat/llm.service';
import type { AnswerJudgeResult, RagEvaluationCase } from './evaluation.types';

interface AnswerJudgeInput {
  evaluationCase: RagEvaluationCase;
  sources: Array<{ headingPath?: string[]; content: string }>;
  answer: string;
}

function invalidResult(error: string): AnswerJudgeResult {
  return {
    score: null,
    missingPoints: [],
    hallucination: false,
    reason: '',
    judgeError: error,
  };
}

@Injectable()
export class RagAnswerJudgeService {
  constructor(private readonly llmService: LlmService) {}

  async judge(input: AnswerJudgeInput): Promise<AnswerJudgeResult> {
    const expectedPoints = input.evaluationCase.expected.mustMention ?? [];
    const context = input.sources
      .map((source, index) => {
        const headingPath = (source.headingPath ?? []).join(' > ');
        const content =
          source.content.length > 1800 ? `${source.content.slice(0, 1800)}...` : source.content;
        return `[${index + 1}] 位置：${headingPath}\n${content}`;
      })
      .join('\n\n');

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是严格的知识库问答评估员。',
          '只能根据检索资料、期望关键点和给定回答评分，不能补充外部知识。',
          'score：2=正确且关键点完整，1=部分正确，0=错误或编造。',
          '只输出 JSON：{"score":0|1|2,"missingPoints":["..."],"hallucination":true|false,"reason":"简短原因"}。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `问题：${input.evaluationCase.question}`,
          '期望关键点：',
          ...expectedPoints.map((point, index) => `${index + 1}. ${point.point}`),
          '',
          '检索资料：',
          context,
          '',
          '待评估回答：',
          input.answer,
        ].join('\n'),
      },
    ];

    try {
      const raw = await this.llmService.complete(messages, { temperature: 0 });
      return this.parseVerdict(raw);
    } catch {
      return invalidResult('answer judge 调用失败');
    }
  }

  private parseVerdict(raw: string): AnswerJudgeResult {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return invalidResult('answer judge JSON 解析失败');

    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      const score = parsed.score;
      const missingPoints = parsed.missingPoints;
      const hallucination = parsed.hallucination;
      const reason = parsed.reason;
      const validScore = score === 0 || score === 1 || score === 2;
      const validMissing =
        Array.isArray(missingPoints) && missingPoints.every((point) => typeof point === 'string');

      if (
        !validScore ||
        !validMissing ||
        typeof hallucination !== 'boolean' ||
        typeof reason !== 'string'
      ) {
        return invalidResult('answer judge JSON 解析失败');
      }

      return {
        score,
        missingPoints: missingPoints,
        hallucination,
        reason,
      };
    } catch {
      return invalidResult('answer judge JSON 解析失败');
    }
  }
}
