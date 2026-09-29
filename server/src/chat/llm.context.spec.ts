import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service';

function toolResponse(args: string, name = 'search_knowledge_base') {
  return {
    data: {
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: { name, arguments: args },
              },
            ],
          },
        },
      ],
    },
  };
}

function createService() {
  const httpService = { post: jest.fn() };
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'llm.apiKey') return 'llm-key';
      if (key === 'llm.apiUrl') return 'https://llm.example/chat/completions';
      if (key === 'llm.model') return 'test-model';
      if (key === 'llm.maxTokens') return 128;
      if (key === 'llm.temperature') return 0.1;
      throw new Error(`missing ${key}`);
    }),
  };
  const service = new LlmService(
    httpService as unknown as HttpService,
    configService as unknown as ConfigService,
  );
  return { service, httpService };
}

describe('D7 LlmService context planning', () => {
  it('没有历史时 condenseQuestion 不调用模型并保留原问题', async () => {
    const { service, httpService } = createService();

    await expect(service.condenseQuestion([], '有多少问题')).resolves.toBe('有多少问题');
    expect(httpService.post).not.toHaveBeenCalled();
  });

  it('有历史时请求单行 standalone query', async () => {
    const { service, httpService } = createService();
    httpService.post.mockReturnValue(
      of({ data: { choices: [{ message: { content: 'SEO 审计报告中有多少个问题？\n多余行' } }] } }),
    );

    await expect(
      service.condenseQuestion(
        [
          { role: 'user', content: '我的网站 SEO 数据怎么样。' },
          { role: 'assistant', content: 'SEO 健康评分 42/100。' },
        ],
        '有多少问题',
      ),
    ).resolves.toBe('SEO 审计报告中有多少个问题？');

    const [, body] = httpService.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const sentMessages = body.messages as Array<{ role: string; content: string }>;
    expect(sentMessages.at(-1)?.content).toContain('有多少问题');
    expect(sentMessages.some((message) => message.content.includes('SEO 健康评分'))).toBe(true);
  });

  it('解析 search_knowledge_base tool call 并校验参数', async () => {
    const { service, httpService } = createService();
    httpService.post.mockReturnValue(
      of(toolResponse(JSON.stringify({ query: 'SEO 审计报告问题数量', limit: 20 }))),
    );

    await expect(service.planSearchTool('有多少问题', [])).resolves.toEqual({
      action: 'search',
      query: 'SEO 审计报告问题数量',
      limit: 10,
    });
    const [, body] = httpService.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: 'function',
        function: expect.objectContaining({ name: 'search_knowledge_base' }),
      }),
    ]);
    expect(JSON.stringify(body.tools)).not.toContain('workspaceId');
  });

  it('拒绝未知工具、非法 JSON 和 workspaceId 参数时安全降级为搜索原问题', async () => {
    const { service, httpService } = createService();
    httpService.post
      .mockReturnValueOnce(
        of(toolResponse(JSON.stringify({ workspaceId: 'workspace-2' }), 'delete_file')),
      )
      .mockReturnValueOnce(of(toolResponse('{bad')));

    await expect(service.planSearchTool('问题', [])).resolves.toEqual({
      action: 'search',
      query: '问题',
      limit: 5,
    });
    await expect(service.planSearchTool('问题', [])).resolves.toEqual({
      action: 'search',
      query: '问题',
      limit: 5,
    });
  });

  it('judgeRelevance 把历史摘要传给模型', async () => {
    const { service, httpService } = createService();
    httpService.post.mockReturnValue(
      of({
        data: { choices: [{ message: { content: '{"relevance":"relevant","reason":"足够"}' } }] },
      }),
    );

    await expect(
      service.judgeRelevance('有多少问题', [{ content: 'Critical: 2' }], '上一轮讨论 SEO 审计报告'),
    ).resolves.toEqual({ relevance: 'relevant', reason: '足够' });

    const [, body] = httpService.post.mock.calls[0] as unknown as [string, Record<string, unknown>];
    const userPrompt = (body.messages as Array<{ content: string }>).at(-1)?.content ?? '';
    expect(userPrompt).toContain('SEO 审计报告');
  });
});
