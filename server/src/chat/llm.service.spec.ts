import { Readable } from 'stream';
import { of, throwError } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LlmService, parseOpenAiSseLines, type ChatMessage } from './llm.service';

async function toArray<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

describe('parseOpenAiSseLines', () => {
  it('解析 delta、忽略空行/非法行，并在 [DONE] 后停止', async () => {
    const lines = [
      ': keep-alive\n',
      '\n',
      'not-data-line\n',
      'data: {"choices":[{"delta":{"content":"你好"}}]}\n',
      'data: broken-json\n',
      'data: {"choices":[{"delta":{"content":"！"}}]}\n',
      'data: [DONE]\n',
      'data: {"choices":[{"delta":{"content":"不应输出"}}]}\n',
    ];

    await expect(toArray(parseOpenAiSseLines(lines))).resolves.toEqual(['你好', '！']);
  });

  it('支持拆分传输的不完整 SSE 行', async () => {
    const lines = Readable.from([
      'data: {"choices":[{"del',
      'ta":{"content":"片段"}}]}',
      '\ndata: [DONE]\n',
    ]);

    await expect(toArray(parseOpenAiSseLines(lines))).resolves.toEqual(['片段']);
  });
});

describe('LlmService', () => {
  const messages: ChatMessage[] = [
    { role: 'system', content: '只根据资料回答' },
    { role: 'user', content: 'pgvector 是什么？' },
  ];
  let httpService: { post: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let service: LlmService;

  beforeEach(() => {
    httpService = { post: jest.fn() };
    configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'llm.apiKey') return 'deepseek-key';
        if (key === 'llm.apiUrl') return 'https://llm.example/chat/completions';
        if (key === 'llm.model') return 'test-model';
        if (key === 'llm.maxTokens') return 64;
        if (key === 'llm.temperature') return 0.1;
        throw new Error(`missing ${key}`);
      }),
    };
    service = new LlmService(
      httpService as unknown as HttpService,
      configService as unknown as ConfigService,
    );
  });

  it('请求流式补全并转发所有内容增量', async () => {
    httpService.post.mockReturnValue(
      of({
        data: Readable.from([
          'data: {"choices":[{"delta":{"content":"向量"}}]}\n',
          'data: {"choices":[{"delta":{"content":"数据库"}}]}\n',
          'data: [DONE]\n',
        ]),
      }),
    );

    await expect(toArray(service.streamChat(messages))).resolves.toEqual(['向量', '数据库']);

    expect(httpService.post).toHaveBeenCalledTimes(1);
    const [url, body, options] = httpService.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(url).toBe('https://llm.example/chat/completions');
    expect(body).toMatchObject({
      model: 'test-model',
      messages,
      stream: true,
      max_tokens: 64,
      temperature: 0.1,
    });
    expect(options).toMatchObject({
      responseType: 'stream',
      headers: { Authorization: 'Bearer deepseek-key' },
    });
  });

  it('429 限流重试一次后继续成功', async () => {
    const rateLimitError = {
      isAxiosError: true,
      response: { status: 429 },
    };
    httpService.post.mockReturnValueOnce(throwError(() => rateLimitError)).mockReturnValueOnce(
      of({
        data: Readable.from([
          'data: {"choices":[{"delta":{"content":"重试成功"}}]}\n',
          'data: [DONE]\n',
        ]),
      }),
    );

    await expect(toArray(service.streamChat(messages))).resolves.toEqual(['重试成功']);
    expect(httpService.post).toHaveBeenCalledTimes(2);
  });

  it('DeepSeek key 未配置时给出明确错误，不发起 HTTP 请求', async () => {
    const emptyKeyConfig = {
      getOrThrow: jest.fn((key: string) => (key === 'llm.apiKey' ? '' : 'unused')),
    };
    const isolatedService = new LlmService(
      httpService as unknown as HttpService,
      emptyKeyConfig as unknown as ConfigService,
    );

    await expect(toArray(isolatedService.streamChat(messages))).rejects.toThrow(
      'DEEPSEEK_API_KEY 未配置',
    );
    expect(httpService.post).not.toHaveBeenCalled();
  });
  it('D4 非流式请求返回助手文本', async () => {
    const d4Service = service as unknown as {
      complete: (messages: ChatMessage[]) => Promise<string>;
    };
    httpService.post.mockReturnValue(
      of({ data: { choices: [{ message: { content: '  纯文本答案  ' } }] } }),
    );

    await expect(d4Service.complete(messages)).resolves.toBe('纯文本答案');
  });

  it('D5 answer judge 可用 temperature 0 调用非流式补全', async () => {
    httpService.post.mockReturnValue(of({ data: { choices: [{ message: { content: 'ok' } }] } }));

    await expect(service.complete(messages, { temperature: 0 })).resolves.toBe('ok');
    const [, body] = httpService.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body.temperature).toBe(0);
  });
  it('D4 judge 解析严格 JSON 并归一化结果', async () => {
    const d4Service = service as unknown as {
      judgeRelevance: (
        question: string,
        sources: Array<{ content: string }>,
      ) => Promise<{ relevance: 'relevant' | 'irrelevant'; reason: string }>;
    };
    httpService.post.mockReturnValue(
      of({
        data: {
          choices: [
            { message: { content: '```json\n{"relevance":"relevant","reason":"足够"}\n```' } },
          ],
        },
      }),
    );

    await expect(d4Service.judgeRelevance('问题', [{ content: '资料' }])).resolves.toEqual({
      relevance: 'relevant',
      reason: '足够',
    });
  });

  it('D4 judge 非法 JSON 抛出安全错误，不暴露上游响应', async () => {
    const d4Service = service as unknown as {
      judgeRelevance: (
        question: string,
        sources: Array<{ content: string }>,
      ) => Promise<{ relevance: 'relevant' | 'irrelevant'; reason: string }>;
    };
    httpService.post.mockReturnValue(
      of({ data: { choices: [{ message: { content: '不是 JSON' } }] } }),
    );

    await expect(d4Service.judgeRelevance('问题', [{ content: '资料' }])).rejects.toThrow(
      '相关性判断结果无法解析',
    );
  });

  it('D4 rewrite 返回单行检索查询', async () => {
    const d4Service = service as unknown as {
      rewriteQuery: (originalQuestion: string, currentQuery: string) => Promise<string>;
    };
    httpService.post.mockReturnValue(
      of({ data: { choices: [{ message: { content: 'pgvector 余弦距离\n' } }] } }),
    );

    await expect(d4Service.rewriteQuery('原问题', '当前查询')).resolves.toBe('pgvector 余弦距离');
  });
  it('非瞬时错误不重试，并抛出用户可理解的错误', async () => {
    httpService.post.mockReturnValue(
      throwError(() => ({ isAxiosError: true, response: { status: 401 } })),
    );

    await expect(toArray(service.streamChat(messages))).rejects.toThrow('模型服务鉴权失败');
    expect(httpService.post).toHaveBeenCalledTimes(1);
  });
});
