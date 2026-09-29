import { describe, expect, it, vi } from 'vitest';
import { parseSseStream, type ChatSseEvent } from './sse';

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<ChatSseEvent[]> {
  const events: ChatSseEvent[] = [];
  await parseSseStream(stream, (event) => events.push(event));
  return events;
}

describe('parseSseStream', () => {
  it('解析 named event 并把 data JSON 还原成载荷', async () => {
    const stream = streamFromChunks([
      'event: sources\n',
      'data: {"sources":[{"chunkId":"c1","documentId":"d1","title":"文档","sourcePath":"uploads/a.md","headingPath":["A"],"chunkIndex":0,"content":"内容","similarity":0.9}]}\n',
      '\n',
      'event: delta\n',
      'data: {"content":"向量"}\n\n',
      'event: done\n',
      'data: {"done":true}\n\n',
    ]);

    await expect(collect(stream)).resolves.toEqual([
      {
        type: 'sources',
        sources: [
          {
            chunkId: 'c1',
            documentId: 'd1',
            title: '文档',
            sourcePath: 'uploads/a.md',
            headingPath: ['A'],
            chunkIndex: 0,
            content: '内容',
            similarity: 0.9,
          },
        ],
      },
      { type: 'delta', content: '向量' },
      { type: 'done', done: true },
    ]);
  });

  it('在网络分片导致一行被拆开时仍能解析', async () => {
    const stream = streamFromChunks([
      'event: delta\n',
      'data: {"conte',
      'nt":"片段"}',
      '\n\n',
      'event: done\ndata: {"done":true}\n\n',
    ]);

    await expect(collect(stream)).resolves.toEqual([
      { type: 'delta', content: '片段' },
      { type: 'done', done: true },
    ]);
  });

  it('跳过无效 JSON 和未知事件，不让一次坏帧崩溃整个流', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stream = streamFromChunks([
      'event: delta\ndata: broken\n\n',
      'event: ping\ndata: {}\n\n',
      'event: done\ndata: {"done":true}\n\n',
    ]);

    await expect(collect(stream)).resolves.toEqual([{ type: 'done', done: true }]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('在流结束时 flush 未跟随空行的最后事件', async () => {
    const stream = streamFromChunks(['event: delta\n', 'data: {"content":"末尾"}']);

    await expect(collect(stream)).resolves.toEqual([{ type: 'delta', content: '末尾' }]);
  });
});
