import { Injectable, Logger } from '@nestjs/common';
import { DocumentsService, type TraceableSearchResult } from '../documents/documents.service';
import { LlmService } from './llm.service';
import { AsyncEventQueue } from './rag/async-event-queue';
import { RagGraphService } from './rag/rag-graph.service';
import { type RagGraphState } from './rag/rag-state';

/**
 * 对外 SSE 事件契约。前端 client/src/features/chat/types.ts 与这里的类型一一对应；
 * D4 可以改后端内部编排，但绝不能改这四个 named event 的名字和载荷形状。
 */
export type ChatStreamEvent =
  | { type: 'sources'; sources: TraceableSearchResult[] }
  | { type: 'delta'; content: string }
  | { type: 'done'; done: true }
  | { type: 'error'; message: string };

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    // 必须用 class token 注入；结构化类型会让 Nest 编译出的元数据变成 Object，导致 DI 失败。
    private readonly documentsService: DocumentsService,
    private readonly llmService: LlmService,
    // Nest 注入图服务；Controller -> ChatService -> RagGraphService 保持单向依赖。
    private readonly ragGraphService: RagGraphService,
  ) {}

  /**
   * 对外仍然是 AsyncGenerator：Controller 完全不需要理解 LangGraph。
   * 内部流程改为 StateGraph：
   * retrieve -> judge -> conditional edge -> generate / rewriteQuery / fallback。
   */
  async *answerStream(
    question: string,
    workspaceId: string,
    limit = 5,
  ): AsyncGenerator<ChatStreamEvent> {
    // 这是数据隔离的最后防线；即使 Guard 配错，也不允许空 workspace 进入 pgvector 查询。
    if (!workspaceId.trim()) {
      this.logger.warn('聊天检索缺少 workspaceId，已拒绝执行');
      yield { type: 'error', message: '知识库检索失败，请稍后重试' };
      return;
    }

    const queue = new AsyncEventQueue<ChatStreamEvent>();
    const initialState: RagGraphState = {
      originalQuestion: question,
      currentQuery: question,
      workspaceId,
      limit,
      sources: [],
      relevance: 'irrelevant',
      relevanceReason: '',
      rewriteCount: 0,
      // D4 硬限制：最多一次重写，即最多两次向量检索，防止模型判断抖动造成无限循环。
      maxRewrites: 1,
      retrieveCount: 0,
      errorMessage: undefined,
      lastRewrittenQuery: undefined,
      answer: undefined,
    };

    // run 与消费 stream 并发：Node 在后台执行图，事件一旦 push 就被这里 yield 给 Controller。
    const run = this.ragGraphService.run(initialState, queue);
    try {
      yield* queue.stream();
    } finally {
      // 消费端异常退出时也不能留下未观察的 rejection。
      await run.catch((error) => {
        this.logger.error(
          `RAG StateGraph 执行失败: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      });
    }
  }
}
