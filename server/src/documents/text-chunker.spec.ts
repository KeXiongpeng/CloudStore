import { chunkPlainText } from './text-chunker';

describe('chunkPlainText', () => {
  it('按空行分段装箱，并保留段落顺序', () => {
    const chunks = chunkPlainText('第一段。\n\n第二段。\n\n第三段。', { maxChunkChars: 100 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.content).toBe('第一段。\n\n第二段。\n\n第三段。');
  });

  it('超过预算时开新 chunk', () => {
    const first = '甲'.repeat(60);
    const second = '乙'.repeat(60);
    const chunks = chunkPlainText(`${first}\n\n${second}`, { maxChunkChars: 100 });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.content).toBe(first);
    expect(chunks[1]?.content).toBe(second);
  });

  it('单个超长段落硬切并保留 overlap', () => {
    const content = 'ABCDEFGH';
    const chunks = chunkPlainText(content, { maxChunkChars: 5, overlapChars: 2 });

    expect(chunks.map((chunk) => chunk.content)).toEqual(['ABCDE', 'DEFGH']);
  });

  it('空白文本不产出空 chunk', () => {
    expect(chunkPlainText('  \n\n  ')).toEqual([]);
  });
});
