import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'stream';

/** OpenAI-compatible 非流式响应中 D4 用到的最小字段。 */
interface OpenAiToolCall {
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

interface OpenAiCompletion {
  choices?: Array<{
    message?: {
      content?: unknown;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
}
/** OpenAI-compatible 对话消息；D3 只使用 system + user。 */
export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

/** 目前只允许 judge 覆盖 temperature；避免评估工具意外改变模型与输出预算。 */
export type CompleteOptions = { temperature?: number; tools?: unknown[]; toolChoice?: string };

export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type SearchToolPlan =
  | { action: 'search'; query: string; limit: number }
  | { action: 'answer_from_history' }
  | { action: 'clarify' };

/**
 * 解析 OpenAI-compatible SSE 文本流。
 * 网络传输不会保证按行分片，所以必须先缓冲文本，再按换行切出完整事件行。
 */
export async function* parseOpenAiSseLines(
  chunks: Iterable<string> | AsyncIterable<string>,
): AsyncGenerator<string> {
  let buffer = '';

  const emitLine = async function* (line: string): AsyncGenerator<string> {
    const normalized = line.trim();
    if (!normalized.startsWith('data:')) return;

    const payload = normalized.slice(5).trim();
    if (payload === '[DONE]') return;
    if (!payload) return;

    try {
      const parsed = JSON.parse(payload) as {
        choices?: Array<{ delta?: { content?: unknown } }>;
      };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === 'string' && content.length > 0) {
        yield content;
      }
    } catch {
      // 上游可能有 keep-alive 或坏行；跳过，不让一次坏行中断整个回答。
    }
  };

  for await (const chunk of chunks) {
    buffer += chunk;
    let newlineIndex = buffer.search(/\r?\n/);

    while (newlineIndex >= 0) {
      const matchedNewline = buffer.match(/\r?\n/)?.[0] ?? '\n';
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + matchedNewline.length);
      yield* emitLine(line);
      if (line.trim() === 'data: [DONE]') return;
      newlineIndex = buffer.search(/\r?\n/);
    }
  }

  // 流结束时可能还有最后一行没有换行符；也应尝试解析。
  if (buffer.length > 0) {
    yield* emitLine(buffer);
  }
}
@Injectable()
export class LlmService {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 调用 OpenAI-compatible chat completions。
   * 返回的是文本增量 AsyncGenerator；调用方决定如何组装 SSE。
   */
  async *streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
    const stream = await this.requestStream(messages);
    // Node 按字节流返回，这里让 Readable 以 UTF-8 解码后按行迭代。
    yield* parseOpenAiSseLines(stream.setEncoding('utf8'));
  }

  /**
   * D4 新增：非流式补全。
   * judge / rewrite 不需要逐字输出给用户，整段 JSON 或短查询更容易解析。
   * 这里仍然复用 OpenAI-compatible 配置，不引入 LangChain 模型客户端。
   */
  async complete(messages: ChatMessage[], options?: CompleteOptions): Promise<string> {
    const response = await this.requestComplete(messages, options);
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('模型服务没有返回文本');
    }
    return content.trim();
  }

  /**
   * 判断“原始问题 + 当前检索片段”是否足够回答。
   * 要求模型只输出 JSON；解析失败由 RAG 图安全降级，不把模型原样输出发给前端。
   */
  /** 把最近对话压成可独立理解的向量检索 query；没有历史时不浪费模型调用。 */
  async condenseQuestion(history: ChatHistoryMessage[], question: string): Promise<string> {
    const compactHistory = history
      .slice(-8)
      .map((message) => ({ role: message.role, content: message.content.slice(0, 2000) }));
    if (compactHistory.length === 0) return question;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你负责把用户最新问题改写成一个不依赖上下文也能理解的 standalone query。',
          '只输出一行查询。',
          '如果最新问题已经完整，不要改写。',
          '不要回答问题，不要补充事实，不要使用 Markdown。',
        ].join('\n'),
      },
      ...compactHistory,
      { role: 'user', content: `最新问题：${question}` },
    ];
    const query = (await this.complete(messages, { temperature: 0.1 }))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!query) throw new Error('上下文查询改写结果为空');
    return query.slice(0, 1000);
  }

  /** 第一版只暴露一个检索工具；workspaceId 由服务端注入，永远不会进入模型参数。 */
  async planSearchTool(question: string, history: ChatHistoryMessage[]): Promise<SearchToolPlan> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是知识库问答的检索规划器。',
          '如果需要当前工作区资料，调用 search_knowledge_base。',
          '如果上一轮资料已经在对话中足以回答，返回 answer_from_history。',
          '如果缺少指代且无法改写，返回 clarify。',
        ].join('\n'),
      },
      ...history
        .slice(-4)
        .map((message) => ({ role: message.role, content: message.content.slice(0, 1000) })),
      { role: 'user', content: question },
    ];

    try {
      const response = await this.requestComplete(messages, {
        temperature: 0,
        tools: [
          {
            type: 'function',
            function: {
              name: 'search_knowledge_base',
              description: '在当前工作区知识库中检索资料。',
              parameters: {
                type: 'object',
                properties: {
                  query: { type: 'string', description: '完整 standalone query' },
                  limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
                },
                required: ['query'],
              },
            },
          },
        ],
        toolChoice: 'auto',
      });
      const toolCall = response.choices?.[0]?.message?.tool_calls?.[0];
      const name = toolCall?.function?.name;
      const rawArguments = toolCall?.function?.arguments;
      if (name !== 'search_knowledge_base' || typeof rawArguments !== 'string') {
        return { action: 'search', query: question, limit: 5 };
      }
      const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
      if (typeof parsed.workspaceId === 'string' || typeof parsed.query !== 'string') {
        return { action: 'search', query: question, limit: 5 };
      }
      const query = parsed.query.trim().slice(0, 1000);
      if (!query) return { action: 'search', query: question, limit: 5 };
      const limit = typeof parsed.limit === 'number' ? Math.trunc(parsed.limit) : 5;
      return { action: 'search', query, limit: Math.min(10, Math.max(1, limit)) };
    } catch {
      return { action: 'search', query: question, limit: 5 };
    }
  }

  async judgeRelevance(
    question: string,
    sources: Array<{ content: string }>,
    historySummary?: string,
  ): Promise<{ relevance: 'relevant' | 'irrelevant'; reason: string }> {
    const context = sources
      .map((source, index) => `[${index + 1}]\n${source.content}`)
      .join('\n\n');
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你是严格的知识库检索相关性评审。',
          '判断资料是否足以回答用户问题，不要尝试自己回答。',
          '只输出 JSON：{"relevance":"relevant|irrelevant","reason":"简短原因"}。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: historySummary
          ? `对话上下文摘要：${historySummary}\n\n用户问题：\n${question}\n\n检索资料：\n${context}`
          : `用户问题：\n${question}\n\n检索资料：\n${context}`,
      },
    ];

    const raw = await this.complete(messages);
    const parsed = this.parseJsonObject(raw);
    const relevance =
      parsed.relevance === 'relevant'
        ? 'relevant'
        : parsed.relevance === 'irrelevant'
          ? 'irrelevant'
          : null;
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    if (!relevance) {
      throw new Error('相关性判断结果无法解析');
    }
    return { relevance, reason };
  }

  /**
   * 把用户的自然语言问题改写成更适合向量检索的短查询。
   * 模型输出多余解释/代码块时，这里只保留第一行；空结果交给上层安全降级。
   */
  async rewriteQuery(originalQuestion: string, currentQuery: string): Promise<string> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          '你要为向量检索改写问题。',
          '保留原意，补充关键术语，去掉口语和寒暄。',
          '只输出一行查询，不要解释、不要编号、不要使用 Markdown。',
        ].join('\n'),
      },
      { role: 'user', content: `原始问题：${originalQuestion}\n当前查询：${currentQuery}` },
    ];

    const query = (await this.complete(messages))
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!query) {
      throw new Error('查询重写结果为空');
    }
    return query;
  }

  /** 非流式请求独立封装；流式请求返回 Node Readable，二者响应结构不同。 */
  private async requestComplete(
    messages: ChatMessage[],
    options?: CompleteOptions,
    attempt = 1,
  ): Promise<OpenAiCompletion> {
    const apiUrl = this.configService.getOrThrow<string>('llm.apiUrl');
    const apiKey = this.configService.getOrThrow<string>('llm.apiKey');
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 未配置');
    }
    const model = this.configService.getOrThrow<string>('llm.model');
    const maxTokens = this.configService.getOrThrow<number>('llm.maxTokens');
    const temperature =
      options?.temperature ?? this.configService.getOrThrow<number>('llm.temperature');

    try {
      const response = await firstValueFrom(
        this.httpService.post<OpenAiCompletion>(
          apiUrl,
          {
            model,
            messages,
            stream: false,
            max_tokens: maxTokens,
            temperature,
            ...(options?.tools ? { tools: options.tools } : {}),
            ...(options?.toolChoice ? { tool_choice: options.toolChoice } : {}),
          },
          { headers: { Authorization: `Bearer ${apiKey}` } },
        ),
      );
      return response.data;
    } catch (error) {
      if (attempt < 2 && this.isTransientError(error)) {
        await this.delay(300);
        return this.requestComplete(messages, options, attempt + 1);
      }
      throw this.toUserSafeError(error);
    }
  }

  /** 从纯 JSON 或 ```json 代码块中提取第一个对象；不信任模型输出格式。 */
  private parseJsonObject(raw: string): Record<string, unknown> {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('相关性判断结果无法解析');
    }
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not object');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new Error('相关性判断结果无法解析');
    }
  }
  /** 只对网络/限流/临时服务端错误重试一次；鉴权或参数错误重试没有意义。 */
  private async requestStream(messages: ChatMessage[], attempt = 1): Promise<Readable> {
    const apiUrl = this.configService.getOrThrow<string>('llm.apiUrl');
    // DeepSeek 官方 key 和 SiliconFlow Embedding key 是不同账号/不同计费，必须分开。
    const apiKey = this.configService.getOrThrow<string>('llm.apiKey');
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 未配置');
    }
    const model = this.configService.getOrThrow<string>('llm.model');
    const maxTokens = this.configService.getOrThrow<number>('llm.maxTokens');
    const temperature = this.configService.getOrThrow<number>('llm.temperature');

    try {
      const response = await firstValueFrom(
        this.httpService.post<Readable>(
          apiUrl,
          { model, messages, stream: true, max_tokens: maxTokens, temperature },
          { responseType: 'stream', headers: { Authorization: `Bearer ${apiKey}` } },
        ),
      );
      return response.data;
    } catch (error) {
      if (attempt < 2 && this.isTransientError(error)) {
        await this.delay(300);
        return this.requestStream(messages, attempt + 1);
      }
      throw this.toUserSafeError(error);
    }
  }

  private isTransientError(error: unknown): boolean {
    const status = (error as { response?: { status?: number } })?.response?.status;
    return (
      status === 408 ||
      status === 429 ||
      (typeof status === 'number' && status >= 500 && status < 600)
    );
  }

  /** 把上游异常转成有限、可读、不泄漏 key 或响应体的错误。 */
  private toUserSafeError(error: unknown): Error {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 401 || status === 403) return new Error('模型服务鉴权失败');
    if (status === 400) return new Error('模型服务拒绝了本次请求');
    if (status === 402) return new Error('模型服务余额不足，请充值后重试');
    if (status === 429) return new Error('模型服务限流，请稍后重试');
    if (typeof status === 'number' && status >= 500) return new Error('模型服务暂时不可用');
    return new Error('无法连接模型服务');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolveTimeout) => setTimeout(resolveTimeout, ms));
  }
}
