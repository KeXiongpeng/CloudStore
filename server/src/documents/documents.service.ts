import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { basename, resolve } from 'path';
import { EmbeddingService } from '../embedding/embedding.service';
import { PrismaService } from '../prisma/prisma.service';
import { chunkMarkdown, type MarkdownChunk } from './markdown-chunker';

/** 文档导入结果：skipped 表示 sourcePath + contentHash 都没变，复用已有数据。 */
export interface IngestResult {
  status: 'imported' | 'skipped';
  documentId: string;
  chunkCount: number;
}

/** 可溯源检索结果：后续 RAG 引用来源时靠这些字段定位到原文。 */
export interface TraceableSearchResult {
  chunkId: string;
  documentId: string;
  title: string;
  sourcePath: string;
  headingPath: string[];
  chunkIndex: number;
  content: string;
  similarity: number;
}

/** $queryRaw 返回的原始行：heading_path 是 jsonb，pg 驱动会解析成 JS 数组。 */
interface TraceableSearchRow extends Omit<TraceableSearchResult, 'headingPath'> {
  headingPath: unknown;
}

/** 导入的统一输入：CLI 来源用绝对路径，上传来源用稳定逻辑路径。 */
interface DocumentInput {
  sourcePath: string;
  title: string;
  content: string;
}

// 每批送多少条文本给 embedding API：
// 太小则网络往返次数多，太大则单请求超时/超限风险高，10 是文档场景的常见起点。
const EMBEDDING_BATCH_SIZE = 10;
// 失败重试次数：网络抖动和限流通常重试即可恢复，3 次都失败说明需要人工介入。
const EMBEDDING_MAX_RETRIES = 3;
// 重试间隔基数（毫秒）：按尝试次数线性退避（300ms、600ms），给限流留恢复时间。
const EMBEDDING_RETRY_DELAY_MS = 300;

// 上传文件不能把浏览器传来的路径直接拼进 sourcePath，否则 "../" 可能污染溯源字段。
// 这里只保留文件名；允许中文、英文、数字、空格和少量常见符号，不允许路径分隔符。
const UPLOAD_FILENAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .()_-]*\.md$/u;

// pgvector 的 vector 字段不接受 JS 数组，只接受 "[1,2,3]" 这样的文本字面量。
// 与 D1 EmbeddingService 里的做法一致；参数化绑定保证内容不会被当成 SQL 注入。
function toVectorText(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/** 把浏览器文件名归一成安全的文件名；同时处理 Windows 反斜杠路径。 */
function normalizeUploadFilename(originalFilename: string): string {
  // Windows 文件名可能带 "C:\a\b.md"；先统一成 "/"，再 basename 只保留最后一段。
  const filename = basename(originalFilename.replace(/\\/g, '/')).trim();

  if (!UPLOAD_FILENAME_PATTERN.test(filename)) {
    throw new Error('上传文件名不合法');
  }
  return filename;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * 导入本地 Markdown 文件（CLI 用）：
   * sourcePath 是绝对路径，同一磁盘文件反复导入时天然是同一个 key。
   */
  async ingestFile(filePath: string): Promise<IngestResult> {
    // 统一转绝对路径，避免"相对路径写法不同"导致同一文件被当成两个文档。
    const absolutePath = resolve(filePath);
    const raw = await readFile(absolutePath, 'utf-8');
    const title = basename(absolutePath).replace(/\.[^.]+$/, '');

    return this.ingestDocument({ sourcePath: absolutePath, title, content: raw });
  }

  /**
   * 导入浏览器上传的 Markdown 内容（HTTP 用）：
   * 上传文件没有稳定磁盘路径，所以用 uploads/<安全文件名> 作为逻辑路径。
   * 同名同内容 -> skipped；同名内容变化 -> 删旧 chunks 后重建。
   */
  async ingestUpload(originalFilename: string, content: string): Promise<IngestResult> {
    const filename = normalizeUploadFilename(originalFilename);
    return this.ingestDocument({
      sourcePath: `uploads/${filename}`,
      title: filename.replace(/\.md$/i, ''),
      content,
    });
  }

  /**
   * 文档导入的统一管线：
   * 1. 算 sha256，作为内容的"指纹"；
   * 2. 指纹没变直接跳过（幂等：同一个 sourcePath 反复导入不会重复入库）；
   * 3. 指纹变了（或首次导入）切块 → 分批向量化 → 事务内删旧插新。
   */
  private async ingestDocument(input: DocumentInput): Promise<IngestResult> {
    const { sourcePath, title, content } = input;
    // sha256 对内容变化非常敏感：文件里改一个字，指纹就完全不同。
    const contentHash = createHash('sha256').update(content).digest('hex');

    const existing = await this.prismaService.document.findUnique({
      where: { sourcePath },
    });
    if (existing && existing.contentHash === contentHash) {
      // 指纹一致：内容和库里完全一样，什么都不用做。
      const chunkCount = await this.prismaService.documentChunk.count({
        where: { documentId: existing.id },
      });
      return { status: 'skipped', documentId: existing.id, chunkCount };
    }

    const chunks = chunkMarkdown(content);
    const vectors = await this.embedChunks(chunks);

    const documentId = await this.prismaService.$transaction(async (tx) => {
      // upsert：首次导入 create，内容变化时 update 指纹和标题。
      const document = await tx.document.upsert({
        where: { sourcePath },
        update: { title, contentHash },
        create: { title, sourcePath, contentHash },
      });

      // 内容变化重建：先删旧 chunk 再写新的。
      // 整个流程包在事务里，任何一步失败都整体回滚，不会出现"旧向量删了、新向量没写进去"的中间态。
      if (existing) {
        await tx.documentChunk.deleteMany({ where: { documentId: document.id } });
      }

      for (const [index, chunk] of chunks.entries()) {
        const vector = vectors[index];
        if (!vector) {
          throw new Error(`第 ${index} 个 chunk 缺少向量，导入中止`);
        }
        await tx.$executeRaw`
          INSERT INTO "document_chunks"
            ("id", "document_id", "chunk_index", "content", "heading_path", "embedding")
          VALUES (
            ${randomUUID()},
            ${document.id},
            ${index},
            ${chunk.content},
            ${JSON.stringify(chunk.headingPath)}::jsonb,
            ${toVectorText(vector)}::vector
          )
        `;
      }
      return document.id;
    });

    return { status: 'imported', documentId, chunkCount: chunks.length };
  }

  /**
   * 可溯源语义检索：
   * 把问题向量化后，按余弦距离找出最相似的 chunk，并联表带回文档标题、路径、headingPath。
   */
  async search(query: string, limit = 5, workspaceId?: string): Promise<TraceableSearchResult[]> {
    const vectors = await this.embeddingService.createEmbeddings([query]);
    const queryVector = vectors[0];
    if (!queryVector) {
      throw new Error('查询文本向量化失败');
    }
    const vectorText = toVectorText(queryVector);

    // <=> 是 pgvector 的余弦距离（0~2，越小越相似）；
    // 1 - distance 转成相似度（-1~1，越大越相似），对使用者更直观。
    // JOIN documents 把溯源字段一次带出来，避免调用方再查一次。
    // 统一上传后，知识库必须按 workspace 隔离，且只读取异步索引成功的文档。
    if (workspaceId) {
      const rows = await this.prismaService.$queryRaw<TraceableSearchRow[]>`
        SELECT
          chunk.id::text AS "chunkId",
          doc.id::text AS "documentId",
          doc.title AS "title",
          doc.source_path AS "sourcePath",
          chunk.heading_path AS "headingPath",
          chunk.chunk_index AS "chunkIndex",
          chunk.content AS "content",
          1 - (chunk.embedding <=> ${vectorText}::vector) AS "similarity"
        FROM "document_chunks" AS chunk
        INNER JOIN "documents" AS doc ON doc.id = chunk.document_id
        WHERE doc.workspace_id = ${workspaceId}
          AND doc.index_status = 'indexed'
        ORDER BY chunk.embedding <=> ${vectorText}::vector
        LIMIT ${limit}
      `;
      return rows.map((row) => ({
        ...row,
        headingPath: Array.isArray(row.headingPath) ? (row.headingPath as string[]) : [],
        similarity: Number(row.similarity),
      }));
    }

    const rows = await this.prismaService.$queryRaw<TraceableSearchRow[]>`
      SELECT
        chunk.id::text AS "chunkId",
        doc.id::text AS "documentId",
        doc.title AS "title",
        doc.source_path AS "sourcePath",
        chunk.heading_path AS "headingPath",
        chunk.chunk_index AS "chunkIndex",
        chunk.content AS "content",
        1 - (chunk.embedding <=> ${vectorText}::vector) AS "similarity"
      FROM "document_chunks" AS chunk
      INNER JOIN "documents" AS doc ON doc.id = chunk.document_id
      ORDER BY chunk.embedding <=> ${vectorText}::vector
      LIMIT ${limit}
    `;

    // jsonb 出来的 headingPath 已是数组；similarity 做一次 Number 归一，防止驱动返回字符串。
    return rows.map((row) => ({
      ...row,
      headingPath: Array.isArray(row.headingPath) ? (row.headingPath as string[]) : [],
      similarity: Number(row.similarity),
    }));
  }

  /** 按固定批次大小把所有 chunk 分批向量化，避免一次性发几百条把 API 打挂。 */
  private async embedChunks(chunks: MarkdownChunk[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE).map((chunk) => chunk.content);
      vectors.push(...(await this.embedWithRetry(batch)));
    }
    return vectors;
  }

  /** 单批失败重试：指数级退避不必要，线性退避对学习项目足够。 */
  private async embedWithRetry(texts: string[]): Promise<number[][]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= EMBEDDING_MAX_RETRIES; attempt += 1) {
      try {
        return await this.embeddingService.createEmbeddings(texts);
      } catch (error) {
        lastError = error;
        if (attempt < EMBEDDING_MAX_RETRIES) {
          await this.delay(EMBEDDING_RETRY_DELAY_MS * attempt);
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolveTimeout) => setTimeout(resolveTimeout, ms));
  }
}
