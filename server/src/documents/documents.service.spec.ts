import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { Test } from '@nestjs/testing';
import { EmbeddingService } from '../embedding/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentsService } from './documents.service';

describe('DocumentsService', () => {
  let service: DocumentsService;
  let tempDir: string;

  const embedding = [1, 2, 3, 4];
  const embeddingService = { createEmbeddings: jest.fn() };

  // 事务内句柄：$transaction(mock) 会把这个 mock 传给回调，模拟 prisma.$transaction(async (tx) => ...)。
  const txDocumentUpsert = jest.fn();
  const txChunkDeleteMany = jest.fn();
  const txExecuteRaw = jest.fn().mockResolvedValue(1);
  const tx = {
    document: { upsert: txDocumentUpsert },
    documentChunk: { deleteMany: txChunkDeleteMany },
    $executeRaw: txExecuteRaw,
  };

  const prisma = {
    document: { findUnique: jest.fn() },
    documentChunk: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(async (callback: (txClient: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
    $queryRaw: jest.fn(),
  };

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'd2-docs-'));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    txExecuteRaw.mockResolvedValue(1);

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmbeddingService, useValue: embeddingService },
      ],
    }).compile();

    service = moduleRef.get(DocumentsService);
  });

  it('contentHash 未变化时跳过导入，不浪费 embedding 调用', async () => {
    const content = '# 标题\n\n正文内容';
    const filePath = join(tempDir, 'same.md');
    await writeFile(filePath, content, 'utf-8');
    const hash = createHash('sha256').update(content).digest('hex');
    prisma.document.findUnique.mockResolvedValue({ id: 'doc-1', contentHash: hash });

    const result = await service.ingestFile(filePath);

    expect(result).toEqual({ status: 'skipped', documentId: 'doc-1', chunkCount: 0 });
    expect(embeddingService.createEmbeddings).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('新文档：切块、批量向量化、事务内写入 document 和 chunks', async () => {
    const filePath = join(tempDir, 'new.md');
    await writeFile(filePath, '# A\n\n内容a\n\n## B\n\n内容b', 'utf-8');
    prisma.document.findUnique.mockResolvedValue(null);
    embeddingService.createEmbeddings.mockImplementation(async (texts: string[]) =>
      texts.map(() => embedding),
    );
    txDocumentUpsert.mockResolvedValue({ id: 'doc-new' });

    const result = await service.ingestFile(filePath);

    expect(result).toEqual({ status: 'imported', documentId: 'doc-new', chunkCount: 2 });

    // 两个标题 = 两个 chunk，一次批量请求全部发出。
    expect(embeddingService.createEmbeddings).toHaveBeenCalledTimes(1);
    expect(embeddingService.createEmbeddings).toHaveBeenCalledWith([
      '# A\n\n内容a',
      '## B\n\n内容b',
    ]);

    // 幂等的 key 是绝对路径。
    expect(txDocumentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourcePath: resolve(filePath) },
        create: expect.objectContaining({ title: 'new', sourcePath: resolve(filePath) }),
      }),
    );

    // 每条 chunk 一条 INSERT，参数里带向量字面量和 headingPath JSON。
    expect(txExecuteRaw).toHaveBeenCalledTimes(2);
    const firstInsert = txExecuteRaw.mock.calls[0] as unknown[];
    const sql = (firstInsert[0] as { raw: string[] }).raw.join(' ');
    expect(sql).toContain('INSERT INTO "document_chunks"');
    const firstParams = firstInsert.slice(1) as unknown[];
    expect(firstParams).toContain('doc-new');
    expect(firstParams).toContain('[1,2,3,4]');
    expect(firstParams).toContain('["A"]');

    // 第二条 INSERT 的 headingPath 是嵌套路径 ["A","B"]。
    const secondInsert = txExecuteRaw.mock.calls[1] as unknown[];
    const secondParams = secondInsert.slice(1) as unknown[];
    expect(secondParams).toContain('["A","B"]');

    // 新文档没有旧 chunk，不需要删除。
    expect(txChunkDeleteMany).not.toHaveBeenCalled();
  });

  it('内容变化时删除旧 chunk 后重建', async () => {
    const filePath = join(tempDir, 'changed.md');
    await writeFile(filePath, '# 标题\n\n新的内容', 'utf-8');
    prisma.document.findUnique.mockResolvedValue({ id: 'doc-1', contentHash: '旧的hash' });
    embeddingService.createEmbeddings.mockResolvedValue([embedding]);
    txDocumentUpsert.mockResolvedValue({ id: 'doc-1' });

    const result = await service.ingestFile(filePath);

    expect(result.status).toBe('imported');
    expect(txChunkDeleteMany).toHaveBeenCalledWith({ where: { documentId: 'doc-1' } });
  });

  it('chunk 数量超过批次大小时分批请求，不无限并发', async () => {
    // 12 个段落、每个正好 800 字符：贪心装箱下每个 chunk 装一个段落 → 12 个 chunk。
    const paragraphs = Array.from({ length: 12 }, () => '甲'.repeat(780));
    const filePath = join(tempDir, 'batch.md');
    await writeFile(filePath, `# 长文\n\n${paragraphs.join('\n\n')}`, 'utf-8');
    prisma.document.findUnique.mockResolvedValue(null);
    embeddingService.createEmbeddings.mockImplementation(async (texts: string[]) =>
      texts.map(() => embedding),
    );
    txDocumentUpsert.mockResolvedValue({ id: 'doc-batch' });

    const result = await service.ingestFile(filePath);

    expect(result.chunkCount).toBe(12);
    expect(embeddingService.createEmbeddings).toHaveBeenCalledTimes(2);
    expect(embeddingService.createEmbeddings.mock.calls[0]?.[0]).toHaveLength(10);
    expect(embeddingService.createEmbeddings.mock.calls[1]?.[0]).toHaveLength(2);
  });

  it('批量请求失败时自动重试，重试后成功则继续导入', async () => {
    const filePath = join(tempDir, 'retry.md');
    await writeFile(filePath, '# 标题\n\n正文', 'utf-8');
    prisma.document.findUnique.mockResolvedValue(null);
    embeddingService.createEmbeddings
      .mockRejectedValueOnce(new Error('网络抖动'))
      .mockRejectedValueOnce(new Error('又失败'))
      .mockResolvedValueOnce([embedding]);
    txDocumentUpsert.mockResolvedValue({ id: 'doc-retry' });

    const result = await service.ingestFile(filePath);

    expect(result.status).toBe('imported');
    expect(embeddingService.createEmbeddings).toHaveBeenCalledTimes(3);
  });

  it('检索返回可溯源字段，并按余弦距离排序', async () => {
    const row = {
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      title: 'D1 交接',
      sourcePath: 'C:/notes/D1.md',
      headingPath: ['D1', '数据模型'],
      chunkIndex: 2,
      content: '向量维度是 1024',
      similarity: 0.93,
    };
    prisma.$queryRaw.mockResolvedValue([row]);
    embeddingService.createEmbeddings.mockResolvedValue([embedding]);

    const results = await service.search('D1 的向量维度是多少', 3);

    expect(results).toEqual([row]);
    expect(embeddingService.createEmbeddings).toHaveBeenCalledWith(['D1 的向量维度是多少']);

    const call = prisma.$queryRaw.mock.calls[0] as unknown[];
    const sql = (call[0] as { raw: string[] }).raw.join(' ');
    expect(sql).toContain('document_chunks');
    expect(sql).toContain('<=>');
    expect(sql).toContain('LIMIT');
  });
  it('上传导入使用安全逻辑路径作为幂等 key', async () => {
    prisma.document.findUnique.mockResolvedValue(null);
    embeddingService.createEmbeddings.mockResolvedValue([embedding]);
    txDocumentUpsert.mockResolvedValue({ id: 'doc-upload' });

    const result = await service.ingestUpload('folder/../RAG 学习笔记.md', '# RAG\n\n内容');

    expect(result.status).toBe('imported');
    expect(txDocumentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourcePath: 'uploads/RAG 学习笔记.md' },
        create: expect.objectContaining({
          title: 'RAG 学习笔记',
          sourcePath: 'uploads/RAG 学习笔记.md',
        }),
      }),
    );
  });

  it('同名上传内容未变化时按指纹跳过', async () => {
    const content = '# RAG\n\n内容';
    const hash = createHash('sha256').update(content).digest('hex');
    prisma.document.findUnique.mockResolvedValue({ id: 'doc-upload', contentHash: hash });

    const result = await service.ingestUpload('RAG 学习笔记.md', content);

    expect(result).toEqual({ status: 'skipped', documentId: 'doc-upload', chunkCount: 0 });
    expect(embeddingService.createEmbeddings).not.toHaveBeenCalled();
  });
});
