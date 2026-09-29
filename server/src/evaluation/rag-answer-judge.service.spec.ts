import { LlmService } from '../chat/llm.service';
import { RagAnswerJudgeService } from './rag-answer-judge.service';
import { type RagEvaluationCase } from './evaluation.types';

const evaluationCase: RagEvaluationCase = {
  id: 'fact-001',
  category: 'single-source-fact',
  workspace: 'A',
  question: 'HNSW 的 M 参数是什么？',
  limit: 5,
  expected: {
    behavior: 'answer',
    mustMention: [
      {
        point: 'M 控制每个节点最大连接或出边数量',
        anchors: ['M', '最大', '连接'],
      },
    ],
    expectedSourceHeadingPaths: [['核心参数 M 和 efConstruction']],
    minSources: 1,
    maxSources: 3,
    requireCitation: true,
  },
};

function createService(raw: string | Error) {
  const llmService = {
    complete: jest.fn(async (_messages: unknown[], _options?: unknown) => {
      if (raw instanceof Error) throw raw;
      return raw;
    }),
  };
  const service = new RagAnswerJudgeService(llmService as unknown as LlmService);
  return { service, llmService };
}

describe('RagAnswerJudgeService', () => {
  const input = {
    evaluationCase,
    sources: [{ headingPath: ['核心参数'], content: 'M 是最大出边数。' }],
    answer: 'M 控制每个节点的最大连接数 [1]。',
  };

  it('parses a strict JSON verdict and calls the judge at temperature 0', async () => {
    const { service, llmService } = createService(
      '{"score":2,"missingPoints":[],"hallucination":false,"reason":"覆盖关键点"}',
    );

    await expect(service.judge(input)).resolves.toEqual({
      score: 2,
      missingPoints: [],
      hallucination: false,
      reason: '覆盖关键点',
    });

    expect(llmService.complete).toHaveBeenCalledTimes(1);
    const options = llmService.complete.mock.calls[0]?.[1] as { temperature?: number };
    expect(options.temperature).toBe(0);
  });

  it('parses JSON wrapped in a markdown fence', async () => {
    const { service } = createService(
      '```json\n{"score":1,"missingPoints":["最大连接"],"hallucination":false,"reason":"部分覆盖"}\n```',
    );

    await expect(service.judge(input)).resolves.toMatchObject({
      score: 1,
      missingPoints: ['最大连接'],
    });
  });

  it('returns judgeError instead of throwing for invalid JSON', async () => {
    const { service } = createService('不是 JSON');

    const result = await service.judge(input);
    expect(result.score).toBeNull();
    expect(result.judgeError).toBe('answer judge JSON 解析失败');
  });

  it('returns judgeError instead of throwing for model failure', async () => {
    const { service } = createService(new Error('模型服务限流，请稍后重试'));

    const result = await service.judge(input);
    expect(result.score).toBeNull();
    expect(result.judgeError).toBe('answer judge 调用失败');
  });
});
