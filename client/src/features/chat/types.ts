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

/** 后端 SSE 载荷类型；event name 本身就是 type，这里用于前端 reducer。 */
export type ChatSseEvent =
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'delta'; content: string }
  | { type: 'done'; done: true }
  | { type: 'error'; message: string };

/** 对话气泡；用户消息一步完成，助手消息随 SSE 推进状态。 */
export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status?: 'searching' | 'generating' | 'done' | 'error' | 'stopped';
  sources?: ChatSource[];
  errorMessage?: string;
  /** 失败/停止后重试用的原始用户问题。 */
  retryQuestion?: string;
};
