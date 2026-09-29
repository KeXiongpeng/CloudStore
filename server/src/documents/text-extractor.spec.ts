import { TextExtractor } from './text-extractor';

describe('TextExtractor', () => {
  const extractor = new TextExtractor();

  it('提取 Markdown 文本', async () => {
    const result = await extractor.extract(Buffer.from('# 标题\n\n内容', 'utf8'), 'note.md');
    expect(result.kind).toBe('markdown');
    expect(result.pages[0]?.text).toContain('# 标题');
  });

  it('提取 UTF-8 txt 文本', async () => {
    const result = await extractor.extract(Buffer.from('普通文本', 'utf8'), 'note.txt');
    expect(result.kind).toBe('text');
    expect(result.pages[0]?.text).toBe('普通文本');
  });

  it('空文本返回明确错误', async () => {
    await expect(extractor.extract(Buffer.from('', 'utf8'), 'empty.txt')).rejects.toThrow(
      '文件中没有可索引的文本',
    );
  });
});
