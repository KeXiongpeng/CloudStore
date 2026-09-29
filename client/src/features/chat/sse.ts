import type { ChatSseEvent } from './types';

export type { ChatSseEvent };

const SUPPORTED_EVENTS = new Set(['session', 'sources', 'delta', 'actions', 'done', 'error']);

/**
 * 解析后端 SSE 流。
 * POST + fetch 没有浏览器 EventSource 可用，这里手工处理 named event、行缓冲和 JSON 载荷。
 */
export async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: ChatSseEvent) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventName = '';
  let data = '';

  const dispatch = () => {
    if (!eventName || !data || !SUPPORTED_EVENTS.has(eventName)) {
      eventName = '';
      data = '';
      return;
    }

    try {
      const payload = JSON.parse(data) as Omit<ChatSseEvent, 'type'>;
      onEvent({ type: eventName, ...payload } as ChatSseEvent);
    } catch {
      // 单个坏帧不应让整次回答崩溃；生产上也无需把上游原始数据抛给用户。
      console.warn('忽略无法解析的 SSE 帧');
    }

    eventName = '';
    data = '';
  };

  const handleLine = (rawLine: string) => {
    const line = rawLine.replace(/\r$/, '');
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // SSE 规范允许多行 data；本项目目前都是单行 JSON，这里保留通用拼接。
      data = data ? `${data}\n${line.slice(5).trim()}` : line.slice(5).trim();
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.search(/\r?\n/);
      while (newlineIndex >= 0) {
        const matchedNewline = buffer.match(/\r?\n/)?.[0] ?? '\n';
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + matchedNewline.length);
        handleLine(line);
        newlineIndex = buffer.search(/\r?\n/);
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) handleLine(buffer);
    // 后端每帧都有空行；flush 主要用于最后一帧缺少空行或连接提前结束时保留最后事件。
    dispatch();
  } finally {
    reader.releaseLock();
  }
}
