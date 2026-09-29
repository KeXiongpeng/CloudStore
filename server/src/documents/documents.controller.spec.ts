import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

describe('DocumentsController', () => {
  let controller: DocumentsController;
  const documentsService = {
    ingestUpload: jest.fn(),
    search: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [{ provide: DocumentsService, useValue: documentsService }],
    }).compile();

    controller = moduleRef.get(DocumentsController);
  });

  it('importDocument 把上传缓冲区按 UTF-8 交给服务导入', async () => {
    const file = {
      originalname: 'RAG 学习笔记.md',
      buffer: Buffer.from('# RAG\n\n检索增强生成', 'utf8'),
    } as Express.Multer.File;
    const expected = { status: 'imported', documentId: 'doc-1', chunkCount: 1 };
    documentsService.ingestUpload.mockResolvedValue(expected);

    await expect(controller.importDocument(file)).resolves.toEqual(expected);
    expect(documentsService.ingestUpload).toHaveBeenCalledWith(
      'RAG 学习笔记.md',
      '# RAG\n\n检索增强生成',
    );
  });

  it('importDocument 拒绝没有携带文件或扩展名不是 .md 的请求', async () => {
    await expect(controller.importDocument(undefined)).rejects.toThrow(BadRequestException);

    const wrongFile = {
      originalname: 'notes.txt',
      buffer: Buffer.from('普通文本'),
    } as Express.Multer.File;
    await expect(controller.importDocument(wrongFile)).rejects.toThrow(BadRequestException);
    expect(documentsService.ingestUpload).not.toHaveBeenCalled();
  });

  it('search 传入查询词，并给 limit 提供默认值', async () => {
    const expected = [
      {
        chunkId: 'chunk-1',
        documentId: 'doc-1',
        title: 'D1 笔记',
        sourcePath: 'uploads/D1 笔记.md',
        headingPath: ['D1'],
        chunkIndex: 0,
        content: '向量是方向',
        similarity: 0.9,
      },
    ];
    documentsService.search.mockResolvedValue(expected);

    await expect(controller.search({ query: '向量是什么' })).resolves.toEqual(expected);
    expect(documentsService.search).toHaveBeenCalledWith('向量是什么', 5);
  });

  it('search 保留调用方传入的 limit', async () => {
    documentsService.search.mockResolvedValue([]);

    await expect(controller.search({ query: 'HNSW', limit: 3 })).resolves.toEqual([]);
    expect(documentsService.search).toHaveBeenCalledWith('HNSW', 3);
  });
});
