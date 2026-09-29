import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { EmbeddingService } from '../embedding/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DocumentIndexService } from './document-index.service';
import { TextExtractor } from './text-extractor';

describe('DocumentIndexService', () => {
  it('抽取文本不变且版本未变时跳过 Embedding', async () => {
    const content = '知识库索引内容';
    const contentHash = createHash('sha256').update(content).digest('hex');
    const version = {
      id: 'version-1',
      fileId: 'file-1',
      storageKey: 'key.txt',
      size: Buffer.byteLength(content),
      mimeType: 'text/plain',
      file: { id: 'file-1', name: 'note.txt', workspaceId: 'workspace-1' },
    };
    const document = {
      id: 'document-1',
      fileId: 'file-1',
      fileVersionId: 'version-1',
      indexStatus: 'indexed',
      contentHash,
    };

    const prisma = {
      fileVersion: { findUnique: jest.fn().mockResolvedValue(version) },
      document: {
        findUnique: jest.fn().mockResolvedValue(document),
        update: jest.fn().mockResolvedValue(document),
      },
      $transaction: jest.fn(),
    };
    const storage = {
      getObjectForProcessing: jest.fn().mockResolvedValue(Buffer.from(content, 'utf8')),
    };
    const embedding = { createEmbeddings: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DocumentIndexService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: EmbeddingService, useValue: embedding },
        {
          provide: TextExtractor,
          useValue: {
            extract: jest.fn().mockResolvedValue({
              kind: 'text',
              pages: [{ pageNumber: 1, text: content }],
            }),
          },
        },
      ],
    }).compile();

    const service = moduleRef.get(DocumentIndexService);
    await expect(service.processIndex('version-1')).resolves.toEqual({ status: 'skipped' });

    expect(embedding.createEmbeddings).not.toHaveBeenCalled();
    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'document-1' },
      data: { indexStatus: 'processing' },
    });
  });
});
it('索引失败日志只包含安全摘要，不输出 Axios config 中的 key', async () => {
  const content = '知识库索引内容';
  const version = {
    id: 'version-1',
    fileId: 'file-1',
    storageKey: 'key.txt',
    size: Buffer.byteLength(content),
    mimeType: 'text/plain',
    file: { id: 'file-1', name: 'note.txt', workspaceId: 'workspace-1' },
  };
  const document = {
    id: 'document-1',
    fileId: 'file-1',
    fileVersionId: 'version-1',
    indexStatus: 'processing',
    contentHash: 'old-hash',
  };
  const secret = 'sk-test-secret-key-1234567890';
  const axiosLikeError = Object.assign(new Error('connect EACCES 1.2.3.4:443'), {
    code: 'EACCES',
    response: { status: 401 },
    config: { headers: { Authorization: `Bearer ${secret}` } },
  });
  const prisma = {
    fileVersion: { findUnique: jest.fn().mockResolvedValue(version) },
    document: {
      findUnique: jest.fn().mockResolvedValue(document),
      update: jest.fn().mockResolvedValue(document),
    },
    $transaction: jest.fn(),
  };
  const storage = {
    getObjectForProcessing: jest.fn().mockResolvedValue(Buffer.from(content, 'utf8')),
  };
  const embedding = { createEmbeddings: jest.fn().mockRejectedValue(axiosLikeError) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      DocumentIndexService,
      { provide: PrismaService, useValue: prisma },
      { provide: StorageService, useValue: storage },
      { provide: EmbeddingService, useValue: embedding },
      {
        provide: TextExtractor,
        useValue: {
          extract: jest.fn().mockResolvedValue({
            kind: 'text',
            pages: [{ pageNumber: 1, text: content }],
          }),
        },
      },
    ],
  }).compile();
  const service = moduleRef.get(DocumentIndexService);
  const logger = service['logger'] as unknown as { error: jest.Mock };
  const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);

  await expect(service.processIndex('version-1')).rejects.toThrow('connect EACCES');

  expect(errorSpy).toHaveBeenCalledTimes(1);
  const [message, stack] = errorSpy.mock.calls[0] as unknown[];
  expect(stack).toBeUndefined();
  expect(JSON.stringify(message)).not.toContain(secret);
  expect(message).toContain('"status":401');
});
