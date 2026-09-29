import { Annotation } from '@langchain/langgraph';
import { type TraceableSearchResult } from '../../documents/documents.service';
import { type ChatHistoryMessage } from '../llm.service';

/** judge 节点只输出这两个语义结果；条件路由依赖这个稳定枚举。 */
export type RagRelevance = 'relevant' | 'irrelevant';

export type KnowledgeSearchToolCall = {
  name: 'search_knowledge_base';
  arguments: { query: string; limit: number };
};

export type FallbackKind = 'no_files' | 'no_result' | 'weak_sources';

export const RagGraphState = Annotation.Root({
  originalQuestion: Annotation<string>,
  currentQuery: Annotation<string>,
  workspaceId: Annotation<string>,
  limit: Annotation<number>,

  history: Annotation<ChatHistoryMessage[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),
  sessionId: Annotation<string | undefined>({
    reducer: (_previous, next) => next,
    default: () => undefined,
  }),

  sources: Annotation<TraceableSearchResult[]>({
    reducer: (_previous, next) => next,
    default: () => [],
  }),

  relevance: Annotation<RagRelevance>({
    reducer: (_previous, next) => next,
    default: () => 'irrelevant',
  }),
  relevanceReason: Annotation<string>({
    reducer: (_previous, next) => next,
    default: () => '',
  }),

  rewriteCount: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  retrieveCount: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 0,
  }),
  maxRewrites: Annotation<number>({
    reducer: (_previous, next) => next,
    default: () => 1,
  }),
  lastRewrittenQuery: Annotation<string | undefined>({
    reducer: (_previous, next) => next,
    default: () => undefined,
  }),

  toolCall: Annotation<KnowledgeSearchToolCall | undefined>({
    reducer: (_previous, next) => next,
    default: () => undefined,
  }),
  fallbackKind: Annotation<FallbackKind | undefined>({
    reducer: (_previous, next) => next,
    default: () => undefined,
  }),

  errorMessage: Annotation<string | undefined>({
    reducer: (_previous, next) => next,
    default: () => undefined,
  }),
  answer: Annotation<string | undefined>({
    reducer: (_previous, next) => next,
    default: () => undefined,
  }),
});

export type RagGraphStateUpdate = Partial<typeof RagGraphState.State>;

export type RagGraphStateData = Partial<typeof RagGraphState.State>;
