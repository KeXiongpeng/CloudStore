import { Logger } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import {
  type DocumentsService,
  type TraceableSearchResult,
} from '../../documents/documents.service';
import { type LlmService } from '../llm.service';
import { type ChatStreamEvent } from '../chat.service';
import { RagGraphState, type RagGraphStateUpdate } from './rag-state';

/** 用户可见的固定兜底；和 D3 保持同一句话，避免前端文案回退。 */
export const NO_RELEVANT_SOURCE_FALLBACK =
  '知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。';

const GENERATION_SYSTEM_PROMPT = [
  '你是一个严格基于知识库资料回答问题的助手。',
  '',
  '规则：',
  '1. 只使用用户提供的资料回答问题。',
  '2. 如果资料不足以回答，直接说明知识库中没有足够相关信息。',
  '3. 回答使用简体中文。',
  '4. 回答要简洁、准确、可执行。',
  '5. 引用资料时使用 [1]、[2] 这样的编号。',
  '6. 不要编造资料中不存在的内容。',
].join('\n');

/**
 * 依赖对象是“图和外部世界”的边界。
 * documentsService/llmService 是能力，onEvent 是 SSE 副作用出口。
 * 这些依赖刻意不放进 RagGraphState，State 必须保持可序列化。
 */
export type RagGraphDependencies = {
  documentsService: DocumentsService;
  llmService: LlmService;
  onEvent: (event: ChatStreamEvent) => void;
};

/** 把 [1]/[2] 编号固定在 final sources 的数组顺序上；三个消费端共用这一个顺序。 */
function buildGenerationMessages(question: string, sources: TraceableSearchResult[]) {
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

  return [
    { role: 'system' as const, content: GENERATION_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: `知识库资料：\n\n${context}\n\n用户问题：\n${question}`,
    },
  ];
}

/** 检索上游异常只映射为稳定、可操作的用户文案；不泄漏 Axios body 或 key。 */
function toRetrievalErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 402) return 'Embedding 服务余额不足，请充值或更换可用 API Key 后重试';
  if (status === 401 || status === 403) return 'Embedding 服务鉴权失败，请检查 API Key';
  if (status === 429) return 'Embedding 服务限流，请稍后重试';
  return '知识库检索失败，请稍后重试';
}

/**
 * 创建一次请求专属的 compiled graph。
 *
 * StateGraph 心智模型：
 * - State：所有节点共享的数据黑板；
 * - Node：接收 State、执行副作用/计算、返回 partial State；
 * - Edge：固定走向；Conditional Edge：读取 State 后动态选择下一个 Node。
 *
 * 这里没有给 compile() 传 checkpointer，所以图只在本次请求内存中执行。
 * Checkpoint 可以保存每个 super-step 后的 State，用于恢复/时间旅行/人工审批；
 * 当前聊天是短请求且前端已有 localStorage，引入持久化会增加租户隔离、清理和并发复杂度。
 */
export function createRagGraph(deps: RagGraphDependencies) {
  const logger = new Logger('RagGraph');
  const { documentsService, llmService, onEvent } = deps;

  /**
   * retrieve：唯一允许访问 pgvector 的节点。
   * workspaceId 显式传入，不依赖“别的模块可能已经查过权限”的隐式约定。
   */
  const retrieve = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    // 防御空 workspace：上层 Guard 是权限边界，这里是数据隔离的最后一道闸。
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
      // 每次检索都整体覆盖 sources。这样 final prompt、sources SSE、前端引用一定从同一数组重新编号。
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

  /**
   * judge：用非流式 LLM 做语义判断。
   * Top K 相似不等于语义相关，所以即使 sources 非空也可能被判 irrelevant。
   * judge 解析失败时安全降级：有资料按 D3 行为继续生成；没资料进入重写/兜底。
   */
  const judge = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    if (state.sources.length === 0) {
      const judgeResult = await llmService
        .judgeRelevance(state.originalQuestion, state.sources)
        .catch(() => ({ relevance: 'irrelevant' as const, reason: '相关性判断失败' }));
      return judgeResult;
    }

    try {
      const judgeResult = await llmService.judgeRelevance(state.originalQuestion, state.sources);
      return {
        relevance: judgeResult.relevance,
        relevanceReason: judgeResult.reason,
      };
    } catch {
      return {
        relevance: 'relevant',
        relevanceReason: '相关性判断失败，按 D3 行为基于已有资料回答',
      };
    }
  };

  /** judge 之后的三分支：相关生成；无关且预算未耗尽重写；否则兜底。 */
  const routeAfterJudge = (
    state: typeof RagGraphState.State,
  ): 'generate' | 'rewriteQuery' | 'fallback' => {
    if (state.relevance === 'relevant') return 'generate';
    if (state.rewriteCount < state.maxRewrites) return 'rewriteQuery';
    return 'fallback';
  };

  /** rewrite 后需要单独路由：失败时不能盲目用旧 query 再检索一次。 */
  const routeAfterRewrite = (state: typeof RagGraphState.State): 'retrieve' | 'fallback' =>
    state.lastRewrittenQuery ? 'retrieve' : 'fallback';

  /**
   * rewrite：成功则更新 currentQuery 并消耗预算；失败则不更新 lastRewrittenQuery。
   * 后续 conditional edge 会读取 lastRewrittenQuery，决定进入 retrieve 还是 fallback。
   */
  const rewriteQuery = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    const nextCount = state.rewriteCount + 1;
    try {
      const query = await llmService.rewriteQuery(state.originalQuestion, state.currentQuery);
      return {
        currentQuery: query,
        rewriteCount: nextCount,
        lastRewrittenQuery: query,
      };
    } catch {
      // 重写失败不要再用同一个 query 反复检索；直接耗尽预算，让条件路由进入 fallback。
      return {
        rewriteCount: state.maxRewrites,
        relevanceReason: '查询重写失败，安全降级为兜底',
      };
    }
  };

  /**
   * generate：图内仍然流式。
   * 先发 final sources，再逐个转发 LLM delta，保证前端先渲染引用再接收正文。
   */
  const generate = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    onEvent({ type: 'sources', sources: state.sources });
    // answer 不用于等待整段返回，只是 State 中保留这次流式的完整结果，便于测试/调试。
    let answer = '';

    try {
      for await (const content of llmService.streamChat(
        buildGenerationMessages(state.originalQuestion, state.sources),
      )) {
        answer += content;
        onEvent({ type: 'delta', content });
      }
      onEvent({ type: 'done', done: true });
      return { answer };
    } catch (error) {
      logger.error(
        `LLM 生成失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      // 已经发出的 delta 可以保留；error 后不补 done，D3 前端会把状态切换为可重试。
      onEvent({
        type: 'error',
        message: error instanceof Error ? error.message : '生成失败，请稍后重试',
      });
      return {};
    }
  };

  /**
   * fallback：不调用生成模型，避免无证据编造。
   * 如果二次检索拿到了相似但被 judge 判为无关的片段，仍把该片段作为 final sources 发出，方便用户检查判断依据。
   */
  const fallback = async (state: typeof RagGraphState.State): Promise<RagGraphStateUpdate> => {
    onEvent({ type: 'sources', sources: state.sources });
    onEvent({ type: 'delta', content: NO_RELEVANT_SOURCE_FALLBACK });
    onEvent({ type: 'done', done: true });
    return { answer: NO_RELEVANT_SOURCE_FALLBACK };
  };

  return (
    new StateGraph(RagGraphState)
      .addNode('retrieve', retrieve)
      .addNode('judge', judge)
      .addNode('rewriteQuery', rewriteQuery)
      .addNode('generate', generate)
      .addNode('fallback', fallback)
      .addEdge(START, 'retrieve')
      // retrieve 失败时直接结束，已经发过 error，绝不能继续 judge/generate。
      .addConditionalEdges('retrieve', (state) => (state.errorMessage ? END : 'judge'))
      .addConditionalEdges('judge', routeAfterJudge)
      .addConditionalEdges('rewriteQuery', routeAfterRewrite)
      .addEdge('generate', END)
      .addEdge('fallback', END)
      .compile()
  );
}
