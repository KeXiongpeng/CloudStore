export interface TextChunk {
  content: string;
  startPage: number;
  endPage: number;
}

export interface TextChunkerOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

/**
 * 纯文本/pdf 提取文本的通用切块器：
 * 先按空行装箱；单段超预算时按固定窗口硬切并保留 overlap。
 */
export function chunkPlainText(content: string, options: TextChunkerOptions = {}): TextChunk[] {
  const maxChunkChars = Math.max(1, options.maxChunkChars ?? 800);
  const overlapChars = Math.min(Math.max(0, options.overlapChars ?? 80), maxChunkChars - 1);
  const paragraphs = content
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const chunks: TextChunk[] = [];
  let current = '';
  const push = (value: string) => {
    if (value.trim()) chunks.push({ content: value, startPage: 1, endPage: 1 });
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChunkChars) {
      if (current) {
        push(current);
        current = '';
      }
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(start + maxChunkChars, paragraph.length);
        push(paragraph.slice(start, end));
        if (end === paragraph.length) break;
        start = end - overlapChars;
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChunkChars) {
      push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) push(current);
  return chunks;
}
