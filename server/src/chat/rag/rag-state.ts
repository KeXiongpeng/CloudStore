import { Annotation } from '@langchain/langgraph';
import { type TraceableSearchResult } from '../../documents/documents.service';

/** judge 节点只输出这两个语义结果；条件路由依赖这个稳定枚举。 */
export type RagRelevance = 'relevant' | 'irrelevant';

/**
 * LangGraph 的 State 是“共享黑板”。
 * 节点不能互相直接调用，只能返回 partial state，由 StateGraph 合并后传给下一个节点。
 * 因此这里只放 JSON 可序列化数据：HTTP Response、AsyncGenerator、函数都不允许进入 State。
 */
export const RagGraphState = Annotation.Root({
  /** 用户原始问题；query 重写时不能丢失它。 */
  originalQuestion: Annotation<string>,
  /** 当前实际用于向量检索的问题；rewrite 节点会替换它。 */
  currentQuery: Annotation<string>,
  /** 检索隔离边界。即便上层 Guard 已校验，图内部也必须显式带给 DocumentsService。 */
  workspaceId: Annotation<string>,
  /** Top K 数量，来自 DTO 的 limit。 */
  limit: Annotation<number>,

  /** 最近一次 retrieve 的结果；二次检索会整体替换，不追加，避免引用编号混乱。 */
  sources: Annotation<TraceableSearchResult[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),

  /** judge 的结论和简短原因；reason 只用于服务端排查，不作为 SSE 契约。 */
  relevance: Annotation<RagRelevance>({
    reducer: (_previous, next) => next,
    default: () => 'irrelevant',
  }),
  relevanceReason: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),

  /** 硬限制 rewrite 次数。判断写在这一字段里，条件路由永远不要自己写 while。 */
  rewriteCount: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  /** 只服务评估与可观测性；每次 retrieve 节点执行都加一，业务路由不读取它。 */
  retrieveCount: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  maxRewrites: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 1,
  }),
  /** 只有 rewrite 成功才写入；rewrite 后的条件边据此决定 retrieve 或 fallback。 */
  lastRewrittenQuery: Annotation<string | undefined>(),

  /** retrieve 失败时记录用户安全错误；条件路由据此直接结束，不再 judge。 */
  errorMessage: Annotation<string | undefined>(),

  /** 只用于最终状态调试；用户可见内容仍通过事件流逐段发出，不整段等待。 */
  answer: Annotation<string | undefined>(),
});

/** 供节点和测试使用的 State 类型；它是 Annotation 定义推导出的完整 State。 */
export type RagGraphState = typeof RagGraphState.State;

/** 节点只能返回部分字段，LangGraph 会负责合并到完整 State。 */
export type RagGraphStateUpdate = typeof RagGraphState.Update;
