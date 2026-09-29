import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

interface EmbeddingsApiResponse {
  data?: Array<{
    // 批量请求时服务端用 index 标明这条向量对应输入数组的第几条。
    index?: number;
    embedding?: unknown;
  }>;
}

export interface SimilarText {
  id: string;
  content: string;
  similarity: number;
}

@Injectable()
export class EmbeddingService {
  constructor(
    private readonly httpService: HttpService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  // Embedding 本质是把文本压缩成一个固定长度的浮点数组。
  // 相同语义的文本在这个高维空间里距离更近，后续就能用几何距离表达语义相似度。
  async createEmbedding(text: string): Promise<number[]> {
    const apiKey = this.configService.getOrThrow<string>('embedding.apiKey');
    const apiUrl = this.configService.getOrThrow<string>('embedding.apiUrl');
    const model = this.configService.getOrThrow<string>('embedding.model');
    const dimensions = this.configService.getOrThrow<number>('embedding.dimensions');

    const response = await firstValueFrom(
      this.httpService.post<EmbeddingsApiResponse>(
        apiUrl,
        { model, input: [text] },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );

    const vector = response.data.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.some((value) => typeof value !== 'number')) {
      throw new BadRequestException('Embedding API 返回的数据不是有效向量');
    }
    if (vector.length !== dimensions) {
      throw new BadRequestException(
        `Embedding 维度不一致：期望 ${dimensions}，实际 ${vector.length}`,
      );
    }

    return vector;
  }
  // 批量版本：一次请求发送多条文本，减少网络往返次数（D2 文档切块后会有几十上百个 chunk）。
  // OpenAI 兼容协议的响应按 index 字段返回每个输入的向量，这里按 index 归位，防止乱序。
  async createEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const apiKey = this.configService.getOrThrow<string>('embedding.apiKey');
    const apiUrl = this.configService.getOrThrow<string>('embedding.apiUrl');
    const model = this.configService.getOrThrow<string>('embedding.model');
    const dimensions = this.configService.getOrThrow<number>('embedding.dimensions');

    const response = await firstValueFrom(
      this.httpService.post<EmbeddingsApiResponse>(
        apiUrl,
        { model, input: texts },
        { headers: { Authorization: `Bearer ${apiKey}` } },
      ),
    );

    // 先按响应里的 index 归位；协议保证 index 与请求 input 的下标对应。
    const vectors: Array<number[] | undefined> = new Array(texts.length).fill(undefined);
    const items = response.data.data ?? [];
    items.forEach((item, position) => {
      const vector = item.embedding;
      const target = typeof item.index === 'number' ? item.index : position;
      vectors[target] = Array.isArray(vector) ? (vector as number[]) : undefined;
    });

    // 逐条校验：缺失或维度不对都直接抛错，调用方可以整批重试，避免半批脏数据入库。
    return vectors.map((vector, position) => {
      if (!Array.isArray(vector) || vector.some((value) => typeof value !== 'number')) {
        throw new BadRequestException(`Embedding API 批量响应缺少第 ${position} 条有效向量`);
      }
      if (vector.length !== dimensions) {
        throw new BadRequestException(
          `Embedding 维度不一致：期望 ${dimensions}，实际 ${vector.length}`,
        );
      }
      return vector;
    });
  }

  // pgvector 的 vector 字段不接受 JSON 数组，只接受 [1,2,3] 这样的文本字面量。
  // 这里使用 Prisma 标签模板，普通参数仍会走参数化绑定，避免 SQL 注入。
  async ingestText(text: string, metadata?: Record<string, unknown>) {
    const id = randomUUID();
    const embedding = await this.createEmbedding(text);
    const vectorText = this.toVectorText(embedding);

    await this.prismaService.$executeRaw`
      INSERT INTO "text_embeddings" ("id", "content", "metadata", "embedding")
      VALUES (${id}::uuid, ${text}, ${metadata ? JSON.stringify(metadata) : null}::jsonb, ${vectorText}::vector)
    `;

    return { id, dimensions: embedding.length };
  }

  // pgvector 中 <=> 是 cosine distance，范围是 0 到 2：
  // 0 表示方向完全一致，1 表示正交，2 表示方向完全相反。
  // 学习和检索场景更直观的是 cosine similarity，所以这里转换成 1 - cosine_distance。
  async searchByText(text: string, limit = 5): Promise<SimilarText[]> {
    const embedding = await this.createEmbedding(text);
    const vectorText = this.toVectorText(embedding);

    return this.prismaService.$queryRaw<SimilarText[]>`
      SELECT
        "id"::text AS "id",
        "content",
        1 - ("embedding" <=> ${vectorText}::vector) AS "similarity"
      FROM "text_embeddings"
      ORDER BY "embedding" <=> ${vectorText}::vector
      LIMIT ${limit}
    `;
  }

  private toVectorText(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
