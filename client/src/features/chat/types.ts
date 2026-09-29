export type ChatSource = {
  chunkId: string;
  documentId: string;
  title: string;
  sourcePath: string;
  headingPath: string[];
  chunkIndex: number;
  content: string;
  similarity: number;
};

export type ChatActionType = 'navigate' | 'upload' | 'reindex' | 'retry' | 'openSources';

export type ChatAction = {
  id: string;
  type: ChatActionType;
  label: string;
  /** 只接受同源站内路径；渲染前仍会做一层防御。 */
  href?: string;
  payload?: Record<string, unknown>;
};

export type ChatKnowledgeStats = {
  totalFiles: number;
  indexableFiles: number;
  indexed: number;
  processing: number;
  pending: number;
  failed: number;
  unsupported: number;
  lastIndexedAt: string | null;
};

/** 后端 SSE 载荷类型；session/actions 是 D7 追加事件，旧事件保持不变。 */
export type ChatSseEvent =
  | { type: 'session'; session: { id: string; title: string } }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'delta'; content: string }
  | { type: 'actions'; actions: ChatAction[] }
  | { type: 'done'; done: true }
  | { type: 'error'; message: string };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'searching' | 'generating' | 'done' | 'error' | 'stopped';
  sources?: ChatSource[];
  actions?: ChatAction[];
  errorMessage?: string;
  retryQuestion?: string;
};
