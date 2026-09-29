import { chunkMarkdown, type MarkdownChunk } from './markdown-chunker';

// tsconfig 开了 noUncheckedIndexedAccess：数组下标访问的类型是 T | undefined。
// 测试里统一用这个助手做存在性断言，拿到确定存在的元素再写字段断言。
function expectChunk(chunks: MarkdownChunk[], index: number): MarkdownChunk {
  const chunk = chunks[index];
  if (!chunk) {
    throw new Error(`期望第 ${index + 1} 个 chunk 存在，实际只有 ${chunks.length} 个`);
  }
  return chunk;
}

describe('markdown-chunker', () => {
  it('按标题层级切块，并为每个 chunk 生成 headingPath', () => {
    const md = [
      '# 入门指南',
      '这是入门段落。',
      '## 安装',
      '运行安装命令。',
      '## 配置',
      '修改配置文件。',
    ].join('\n');

    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(3);
    const intro = expectChunk(chunks, 0);
    const install = expectChunk(chunks, 1);
    const config = expectChunk(chunks, 2);
    expect(intro.headingPath).toEqual(['入门指南']);
    expect(install.headingPath).toEqual(['入门指南', '安装']);
    expect(config.headingPath).toEqual(['入门指南', '配置']);
    // 标题要和正文留在同一个 chunk 里，保证每个片段能独立理解。
    expect(install.content).toContain('## 安装');
    expect(install.content).toContain('运行安装命令。');
  });

  it('标题之前的导语headingPath为空数组', () => {
    const md = ['开篇导语。', '', '# 正文', '正文内容。'].join('\n');

    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(2);
    const preamble = expectChunk(chunks, 0);
    const body = expectChunk(chunks, 1);
    expect(preamble.headingPath).toEqual([]);
    expect(preamble.content).toContain('开篇导语。');
    expect(body.headingPath).toEqual(['正文']);
  });

  it('代码块内部的 # 和空行不参与切块', () => {
    const md = [
      '# 用法',
      '下面是示例：',
      '```md',
      '# 这不是标题',
      '',
      '仍然是代码块内容',
      '```',
      '结尾说明。',
    ].join('\n');

    const chunks = chunkMarkdown(md);

    expect(chunks).toHaveLength(1);
    const only = expectChunk(chunks, 0);
    expect(only.content).toContain('# 这不是标题');
    expect(only.content).toContain('结尾说明。');
  });

  it('标题层级跳级时 headingPath 按最近父级拼接', () => {
    const md = ['# A', 'a 内容', '### B', 'b 内容'].join('\n');

    const chunks = chunkMarkdown(md);

    expect(expectChunk(chunks, 1).headingPath).toEqual(['A', 'B']);
  });

  it('单个超长段落按字符窗口切块，相邻窗口保留 overlap', () => {
    // 用有区分度的字符序列，overlap 断言才能真正验证"两个 chunk 首尾相接"。
    const longParagraph = Array.from({ length: 300 }, (_, i) =>
      String.fromCharCode(0x4e00 + (i % 500)),
    ).join('');
    const md = `# 长文档\n\n${longParagraph}`;

    const chunks = chunkMarkdown(md, { maxChunkChars: 120, overlapChars: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    const first = expectChunk(chunks, 0);
    const second = expectChunk(chunks, 1);
    // 第二个 chunk 的开头应该和第一个 chunk 的结尾有 20 字符重叠，
    // 这样跨界的语义在两个向量里都存在，检索时不容易漏。
    expect(second.content).toContain(first.content.slice(-20));
    // 每个 chunk 都不超过窗口上限（标题前缀除外，标题单独保留在最前）。
    for (const chunk of chunks) {
      expect(chunk.content.replace('# 长文档\n\n', '').length).toBeLessThanOrEqual(120);
    }
  });

  it('每个 chunk 记录源文件行号，方便溯源', () => {
    const md = ['# 第一节', '内容一', '', '## 第二节', '内容二'].join('\n');

    const chunks = chunkMarkdown(md);

    const first = expectChunk(chunks, 0);
    const second = expectChunk(chunks, 1);
    expect(first.startLine).toBe(1);
    expect(first.endLine).toBe(2);
    expect(second.startLine).toBe(4);
    expect(second.endLine).toBe(5);
  });
});
