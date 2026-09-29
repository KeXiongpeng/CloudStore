import { getAccessToken } from '../../lib/auth';
import { parseSseStream } from './sse';
import type { ChatSseEvent } from './types';

export type AskOptions = {
  workspaceId: string;
  question: string;
  limit?: number;
  signal?: AbortSignal;
  onEvent: (event: ChatSseEvent) => void;
};

/**
 * 后端是 POST SSE，不能用 EventSource。
 * Next.js rewrites 会把同源 /api/workspaces/:id/chat 转发到 NestJS 3000。
 */
export async function askKnowledgeBase({
  workspaceId,
  question,
  limit = 5,
  signal,
  onEvent,
}: AskOptions): Promise<void> {
  const token = getAccessToken();
  // 统一上传索引后，检索必须限定当前 workspace。
  const response = await fetch(`/api/workspaces/${workspaceId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ question, limit }),
    signal,
  });

  if (!response.ok) {
    throw new Error(await toReadableError(response));
  }
  if (!response.body) {
    throw new Error('浏览器不支持流式响应');
  }

  await parseSseStream(response.body, onEvent);
}

async function toReadableError(response: Response): Promise<string> {
  if (response.status === 401) return '请先登录后再提问';
  if (response.status === 429) return '请求过于频繁，请稍后再试';
  if (response.status >= 500) return '问答服务暂时不可用，请稍后重试';

  try {
    const text = await response.text();
    const parsed = JSON.parse(text) as { message?: unknown };
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
  } catch {
    // 后端可能返回纯文本；落到通用错误即可。
  }
  return '请求失败，请稍后重试';
}
