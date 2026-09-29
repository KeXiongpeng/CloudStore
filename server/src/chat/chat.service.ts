import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DocumentsService, type TraceableSearchResult } from '../documents/documents.service';
import { LlmService } from './llm.service';
import { ChatSessionService, type PersistedChatSource } from './chat-session.service';
import { KnowledgeService } from './knowledge.service';
import { AsyncEventQueue } from './rag/async-event-queue';
import { RagGraphService } from './rag/rag-graph.service';
import { type RagGraphStateData } from './rag/rag-state';

export type ChatActionType = 'navigate' | 'upload' | 'reindex' | 'retry' | 'openSources';

export type ChatAction = {
  id: string;
  type: ChatActionType;
  label: string;
  /** 只允许服务端状态推导的站内路径；模型输出永远不会成为 href。 */
  href?: string;
  payload?: Record<string, unknown>;
};

export type ChatStreamEvent =
  | { type: 'session'; session: { id: string; title: string } }
  | { type: 'sources'; sources: TraceableSearchResult[] }
  | { type: 'delta'; content: string }
  | { type: 'actions'; actions: ChatAction[] }
  | { type: 'done'; done: true }
  | { type: 'error'; message: string };

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly llmService: LlmService,
    private readonly ragGraphService: RagGraphService,
    @Optional() @Inject(ChatSessionService) private readonly sessionService?: ChatSessionService,
    @Optional() @Inject(KnowledgeService) private readonly knowledgeService?: KnowledgeService,
  ) {}

  async *answerStream(
    question: string,
    workspaceId: string,
    limit = 5,
    sessionId?: string,
    userId?: string,
  ): AsyncGenerator<ChatStreamEvent> {
    if (!workspaceId.trim()) {
      this.logger.warn('聊天检索缺少 workspaceId，已拒绝执行');
      yield { type: 'error', message: '知识库检索失败，请稍后重试' };
      return;
    }

    let resolvedSessionId: string | undefined;
    let history: Awaited<ReturnType<ChatSessionService['getHistory']>> = [];
    if (this.sessionService && userId) {
      const session = await this.sessionService.resolveForAsk(
        { workspaceId, userId } as Parameters<ChatSessionService['resolveForAsk']>[0],
        sessionId,
        question,
      );
      resolvedSessionId = session.id;
      yield { type: 'session', session };
      history = await this.sessionService.getHistory(session.id, 10);
      await this.sessionService.saveUserMessage(session.id, question);
    }

    const queue = new AsyncEventQueue<ChatStreamEvent>();
    const initialState: RagGraphStateData = {
      originalQuestion: question,
      currentQuery: question,
      workspaceId,
      limit,
      history,
      sessionId: resolvedSessionId,
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

    let finalState: RagGraphStateData | undefined;
    const run = this.ragGraphService.run(initialState, queue).then((state) => {
      finalState = state;
      return state;
    });

    try {
      yield* queue.stream();
    } finally {
      try {
        await run;
      } catch (error) {
        this.logger.error(
          `RAG StateGraph 执行失败: ${error instanceof Error ? error.message : String(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }

      if (
        this.sessionService &&
        resolvedSessionId &&
        typeof finalState?.answer === 'string' &&
        finalState.answer.length > 0
      ) {
        await this.sessionService.saveAssistantMessage(
          resolvedSessionId,
          finalState.answer,
          finalState.sources as unknown as PersistedChatSource[],
        );
      }
    }
  }
}
