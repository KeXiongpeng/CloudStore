import { HttpService } from '@nestjs/axios';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { firstValueFrom, of } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let httpPost: jest.Mock;
  let prisma: { $executeRaw: jest.Mock; $queryRaw: jest.Mock };

  const embedding = Array.from({ length: 4 }, (_, index) => index + 1);

  beforeEach(async () => {
    httpPost = jest.fn().mockReturnValue(
      of({
        data: {
          data: [{ embedding }],
        },
      }),
    );
    prisma = { $executeRaw: jest.fn().mockResolvedValue(1), $queryRaw: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: HttpService, useValue: { post: httpPost } },
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const values: Record<string, string | number> = {
                'embedding.apiKey': 'test-key',
                'embedding.apiUrl': 'https://embedding.example.com/v1/embeddings',
                'embedding.model': 'test-model',
                'embedding.dimensions': 4,
              };
              return values[key];
            },
            getOrThrow: (key: string) => {
              const values: Record<string, string | number> = {
                'embedding.apiKey': 'test-key',
                'embedding.apiUrl': 'https://embedding.example.com/v1/embeddings',
                'embedding.model': 'test-model',
                'embedding.dimensions': 4,
              };
              const value = values[key];
              if (value === undefined) {
                throw new Error(`Missing config: ${key}`);
              }
              return value;
            },
          },
        },
      ],
    }).compile();

    service = moduleRef.get(EmbeddingService);
  });

  it('calls the OpenAI compatible embeddings API and validates the returned vector', async () => {
    await expect(service.createEmbedding('云存储')).resolves.toEqual(embedding);

    expect(httpPost).toHaveBeenCalledWith(
      'https://embedding.example.com/v1/embeddings',
      {
        model: 'test-model',
        input: ['云存储'],
      },
      { headers: { Authorization: 'Bearer test-key' } },
    );
  });

  it('stores text and its pgvector representation', async () => {
    const result = await service.ingestText('云存储', { source: 'learning' });

    expect(typeof result.id).toBe('string');
    expect(result.dimensions).toBe(4);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [sqlTemplate, ...parameters] = prisma.$executeRaw.mock.calls[0];
    const sql = sqlTemplate.raw.join(' ');
    expect(sql).toContain('INSERT INTO "text_embeddings"');
    expect(parameters).toHaveLength(4);
    expect(sql).toContain('::vector');
    expect(parameters).toContain('云存储');
    expect(parameters).toContain('{"source":"learning"}');
    expect(parameters).toContain(`[${embedding.join(',')}]`);
    expect(parameters).toContain(result.id);
  });

  it('queries nearest text by cosine distance and converts it to similarity', async () => {
    const row = { id: 'embedding-id', content: '云存储', similarity: 0.94 };
    prisma.$queryRaw.mockResolvedValue([row]);

    await expect(service.searchByText('云端存储', 3)).resolves.toEqual([row]);

    const [sqlTemplate, vectorText, , limit] = prisma.$queryRaw.mock.calls[0];
    const sql = sqlTemplate.raw.join(' ');
    expect(sql).toContain('<=>');
    expect(sql).toContain('1 - (');
    expect(sql).toContain('LIMIT');
    expect(vectorText).toBe(`[${embedding.join(',')}]`);
    expect(limit).toBe(3);
  });

  it('casts the generated id binding to the PostgreSQL uuid type', () => {
    expect(EmbeddingService.prototype.ingestText.toString()).toContain('${id}::uuid');
  });

  it('批量向量化：一次请求发送多条文本，按顺序返回向量', async () => {
    const secondEmbedding = [4, 3, 2, 1];
    httpPost.mockReturnValueOnce(
      of({
        data: {
          // OpenAI 兼容协议的批量响应带 index 字段，用来把向量放回原位置。
          data: [
            { index: 0, embedding },
            { index: 1, embedding: secondEmbedding },
          ],
        },
      }),
    );

    await expect(service.createEmbeddings(['文本一', '文本二'])).resolves.toEqual([
      embedding,
      secondEmbedding,
    ]);

    expect(httpPost).toHaveBeenCalledWith(
      'https://embedding.example.com/v1/embeddings',
      { model: 'test-model', input: ['文本一', '文本二'] },
      { headers: { Authorization: 'Bearer test-key' } },
    );
  });

  it('批量响应缺少某个向量时直接报错，避免静默丢数据', async () => {
    httpPost.mockReturnValueOnce(
      of({
        data: {
          data: [{ index: 0, embedding }],
        },
      }),
    );

    await expect(service.createEmbeddings(['文本一', '文本二'])).rejects.toThrow(
      BadRequestException,
    );
  });
});
