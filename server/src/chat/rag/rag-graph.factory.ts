import { Logger } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import {
  type DocumentsService,
  type TraceableSearchResult,
} from '../../documents/documents.service';
import { type ChatHistoryMessage, type LlmService } from '../llm.service';
import { type ChatAction, type ChatStreamEvent } from '../chat.service';
import { type KnowledgeService } from '../knowledge.service';
import { RagGraphState, type FallbackKind, type RagGraphStateUpdate } from './rag-state';

export const NO_RELEVANT_SOURCE_FALLBACK =
  '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。';

const GENERATION_SYSTEM_PROMPT = [
  '你是一个严格基于知识库资料回答问题的助手。',
  '',
  '规则：',
  '1. 只使用用户提供的资料回答问题。',
  '2. 用户最新问题可能是对上一轮内容的追问；结合对话上下文理解意图，但答案仍必须来自资料。',
  '3. 如果资料不足以回答，直接说明知识库中没有足够相关信息。',
  '4. 回答使用简体中文。',
  '5. 回答要简洁、准确、可执行。',
  '6. 引用资料时使用 [1]、[2] 这样的编号。',
  '7. 不要编造资料中不存在的内容。',
].join('\n');

export type RagGraphDependencies = {
  documentsService: DocumentsService;
  llmService: LlmService;
  knowledgeService?: KnowledgeService;
  onEvent: (event: ChatStreamEvent) => void;
};

function historySummary(history: ChatHistoryMessage[]): string {
  return history
    .slice(-6)
    .map(
      (message) => `${message.role === 'user' ? '用户' : '助手'}: ${message.content.slice(0, 500)}`,
    )
    .join('\n');
}

function buildGenerationMessages(
  question: string,
  query: string,
  sources: TraceableSearchResult[],
  history: ChatHistoryMessage[],
) {
  const context = sources
    .map((source, index) => {
      const headingPath = Array.isArray(source.headingPath) ? source.headingPath.join(' > ') : '';
      return [
        `[${index + 1}]`,
        `标题：${source.title}`,
        `位置：${headingPath}`,
        `来源：${source.sourcePath}`,
        `chunkIndex：${source.chunkIndex}`,
        '内容：',
        source.content,
      ].join('\n');
    })
    .join('\n\n');
  const priorConversation = historySummary(history);

  return [
    { role: 'system' as const, content: GENERATION_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: [
        priorConversation ? `对话上下文：\n${priorConversation}` : '',
        `知识库资料：\n\n${context}`,
        `用户最新问题：\n${question}`,
        `检索 query：\n${query}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
  ];
}

function toRetrievalErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 402) return 'Embedding 服务余额不足，请充值或更换可用 API Key 后重试';
  if (status === 401 || status === 403) return 'Embedding 服务鉴权失败，请检查 API Key';
  if (status === 429) return 'Embedding 服务限流，请稍后重试';
  return '知识库检索失败，请稍后重试';
}

function fallbackContent(kind: FallbackKind, question: string, sourceCount: number): string {
  if (kind === 'no_files') {
    return '当前工作区还没有可问答的知识库文件。请先上传 Markdown、txt 或 PDF 文件，索引完成后再提问。';
  }
  if (kind === 'weak_sources') {
    return `我在知识库里找到了 ${sourceCount} 个相关片段，但还不足以完整回答「${question}」。你可以查看来源确认线索；如果你能补充文件名、时间、产品名或章节名，我可以继续帮你整理。`;
  }
  return `我在当前知识库里没有找到与「${question}」直接相关的资料。你可以尝试：\n1. 补充文件名、时间、产品名或章节名；\n2. 上传包含该信息的文档；\n3. 换成更具体的问题。`;
}

function buildFallbackActions(
  kind: FallbackKind,
  hasSources: boolean,
  stats?: { processing: number; failed: number },
): ChatAction[] {
  if (kind === 'no_files') {
    return [
      {
        id: 'upload-knowledge',
        type: 'navigate',
        label: '上传知识库文件',
        href: '/files?upload=1',
      },
      { id: 'open-files', type: 'navigate', label: '查看文件管理', href: '/files' },
    ];
  }
  if (kind === 'weak_sources') {
    return [
      { id: 'open-sources', type: 'openSources', label: '查看来源' },
      { id: 'upload-more', type: 'navigate', label: '上传补充资料', href: '/files?upload=1' },
    ];
  }
  const actions: ChatAction[] = [
    { id: 'open-files', type: 'navigate', label: '查看已索引文件', href: '/files' },
  ];
  if (stats && stats.processing > 0) {
    actions.push({
      id: 'view-processing',
      type: 'navigate',
      label: '查看索引进度',
      href: '/files',
    });
  }
  if (stats && stats.failed > 0) {
    actions.push({
      id: 'view-failed',
      type: 'navigate',
      label: '查看失败索引',
      href: '/files?status=failed',
    });
  }
  if (hasSources)
    actions.unshift({ id: 'open-sources', type: 'openSources', label: '查看参考片段' });
  actions.push({
    id: 'upload-more',
    type: 'navigate',
    label: '上传补充资料',
    href: '/files?upload=1',
  });
  return actions;
}

function normalizeSearchPlan(
  plan: { action: string; query?: string; limit?: number },
  question: string,
): { query: string; limit: number } {
  if (typeof plan.query !== 'string' || !plan.query.trim()) {
    return { query: question, limit: 5 };
  }
  const rawLimit = typeof plan.limit === 'number' ? Math.trunc(plan.limit) : 5;
  return { query: plan.query.trim().slice(0, 1000), limit: Math.min(10, Math.max(1, rawLimit)) };
}

export function createRagGraph(deps: RagGraphDependencies) {
  const logger = new Logger('RagGraph');
  const { documentsService, llmService, knowledgeService, onEvent } = deps;

  const condenseQuestion = async (
    state: typeof RagGraphState.State,
  ): Promise<RagGraphStateUpdate> => {
    if (state.history.length === 0) return {};
    try {
      const query = await llmService.condenseQuestion(state.history, state.originalQuestion);
      return { currentQuery: query };
    } catch (error) {
      logger.warn(
        `上下文问题改写失败，已保留原问题: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  };

  const planToolUse = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    try {
      const plan = await llmService.planSearchTool(state.originalQuestion, state.history);
      if (plan.action !== 'search') return {};
      const normalized = normalizeSearchPlan(plan, state.originalQuestion);
      return {
        currentQuery: normalized.query,
        limit: normalized.limit,
        toolCall: { name: 'search_knowledge_base', arguments: normalized },
      };
    } catch {
      return {
        toolCall: {
          name: 'search_knowledge_base',
          arguments: { query: state.originalQuestion, limit: state.limit },
        },
      };
    }
  };

  const searchKnowledgeBase = async (
    state: typeof RagGraphState.State,
  ): Promise<RagGraphStateUpdate> => {
    if (!state.workspaceId.trim()) {
      const message = '知识库检索失败，请稍后重试';
      onEvent({ type: 'error', message });
      return { errorMessage: message, retrieveCount: state.retrieveCount + 1 };
    }

    try {
      const sources = await documentsService.search(
        state.currentQuery,
        state.limit,
        state.workspaceId,
      );
      return { sources, errorMessage: undefined, retrieveCount: state.retrieveCount + 1 };
    } catch (error) {
      const message = toRetrievalErrorMessage(error);
      logger.error(
        `知识库检索失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      onEvent({ type: 'error', message });
      return { errorMessage: message, retrieveCount: state.retrieveCount + 1 };
    }
  };

  const judge = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    const summary = historySummary(state.history);
    if (state.sources.length === 0) {
      const judgeResult = await llmService
        .judgeRelevance(state.originalQuestion, state.sources, summary)
        .catch(() => ({ relevance: 'irrelevant' as const, reason: '相关性判断失败' }));
      return judgeResult;
    }

    try {
      const judgeResult = await llmService.judgeRelevance(
        state.originalQuestion,
        state.sources,
        summary,
      );
      return { relevance: judgeResult.relevance, relevanceReason: judgeResult.reason };
    } catch {
      return { relevance: 'relevant', relevanceReason: '相关性判断失败，基于已有资料回答' };
    }
  };

  const routeAfterJudge = (
    state: typeof RagGraphState.State,
  ): 'generate' | 'rewriteQuery' | 'fallback' => {
    if (state.relevance === 'relevant') return 'generate';
    if (state.rewriteCount < state.maxRewrites) return 'rewriteQuery';
    return 'fallback';
  };

  const routeAfterRewrite = (
    state: typeof RagGraphState.State,
  ): 'searchKnowledgeBase' | 'fallback' =>
    state.lastRewrittenQuery ? 'searchKnowledgeBase' : 'fallback';

  const rewriteQuery = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    const nextCount = state.rewriteCount + 1;
    try {
      const query = await llmService.rewriteQuery(state.originalQuestion, state.currentQuery);
      return { currentQuery: query, rewriteCount: nextCount, lastRewrittenQuery: query };
    } catch {
      return { rewriteCount: state.maxRewrites, relevanceReason: '查询重写失败，安全降级为兜底' };
    }
  };

  const emitAnswerActions = (state: typeof RagGraphState.State): void => {
    if (state.sources.length === 0) return;
    onEvent({
      type: 'actions',
      actions: [{ id: 'open-sources', type: 'openSources', label: '查看来源' }],
    });
  };

  const generate = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    onEvent({ type: 'sources', sources: state.sources });
    let answer = '';

    try {
      for await (const content of llmService.streamChat(
        buildGenerationMessages(
          state.originalQuestion,
          state.currentQuery,
          state.sources,
          state.history,
        ),
      )) {
        answer += content;
        onEvent({ type: 'delta', content });
      }
      emitAnswerActions(state);
      onEvent({ type: 'done', done: true });
      return { answer };
    } catch (error) {
      logger.error(
        `LLM 生成失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      onEvent({
        type: 'error',
        message: error instanceof Error ? error.message : '生成失败，请稍后重试',
      });
      return {};
    }
  };

  const fallback = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    let stats: Awaited<ReturnType<KnowledgeService['getStats']>> | undefined;
    try {
      stats = await knowledgeService?.getStats({ workspaceId: state.workspaceId });
    } catch (error) {
      logger.warn(`获取知识库状态失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    const kind: FallbackKind =
      state.sources.length > 0
        ? 'weak_sources'
        : !stats || stats.indexableFiles === 0
          ? 'no_files'
          : 'no_result';
    const content = fallbackContent(kind, state.originalQuestion, state.sources.length);
    onEvent({ type: 'sources', sources: state.sources });
    onEvent({
      type: 'actions',
      actions: buildFallbackActions(kind, state.sources.length > 0, stats),
    });
    onEvent({ type: 'delta', content });
    onEvent({ type: 'done', done: true });
    return { answer: content, fallbackKind: kind };
  };

  return new StateGraph(RagGraphState)
    .addNode('condenseQuestion', condenseQuestion)
    .addNode('planToolUse', planToolUse)
    .addNode('searchKnowledgeBase', searchKnowledgeBase)
    .addNode('judge', judge)
    .addNode('rewriteQuery', rewriteQuery)
    .addNode('generate', generate)
    .addNode('fallback', fallback)
    .addEdge(START, 'condenseQuestion')
    .addEdge('condenseQuestion', 'planToolUse')
    .addEdge('planToolUse', 'searchKnowledgeBase')
    .addConditionalEdges('searchKnowledgeBase', (state) => (state.errorMessage ? END : 'judge'))
    .addConditionalEdges('judge', routeAfterJudge)
    .addConditionalEdges('rewriteQuery', routeAfterRewrite)
    .addEdge('generate', END)
    .addEdge('fallback', END)
    .compile();
}
