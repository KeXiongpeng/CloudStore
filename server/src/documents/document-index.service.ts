import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { formatSafeError } from '../common/utils/safe-error';
import { chunkMarkdown } from './markdown-chunker';
import { chunkPlainText, type TextChunk } from './text-chunker';
import { TextExtractor } from './text-extractor';

export interface DocumentIndexJobInput {
  fileId: string;
  fileVersionId: string;
  workspaceId: string;
}

const EMBEDDING_BATCH_SIZE = 10;
const EMBEDDING_RETRY_DELAY_MS = 300;

@Injectable()
export class DocumentIndexService {
  private readonly logger = new Logger(DocumentIndexService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly embeddingService: EmbeddingService,
    private readonly textExtractor: TextExtractor,
  ) {}

  async processIndex(fileVersionId: string): Promise<{ status: 'indexed' | 'skipped' }> {
    const version = await this.prisma.fileVersion.findUnique({
      where: { id: fileVersionId },
      include: { file: true },
    });
    if (!version?.file) throw new NotFoundException('FILE_VERSION_NOT_FOUND');

    const document = await this.prisma.document.findUnique({ where: { fileId: version.fileId } });
    if (!document) throw new NotFoundException('DOCUMENT_NOT_FOUND');

    await this.prisma.document.update({
      where: { id: document.id },
      data: { indexStatus: 'processing' },
    });

    try {
      const object = await this.storageService.getObjectForProcessing(version.storageKey);
      const buffer = Buffer.isBuffer(object) ? object : Buffer.from(object as Uint8Array);
      const extracted = await this.textExtractor.extract(buffer, version.file.name);

      const chunks = this.buildChunks(extracted.pages, extracted.kind);
      if (chunks.length === 0) throw new Error('文件中没有可索引的文本');

      const fullText = chunks.map((chunk) => chunk.content).join('\n\n');
      const contentHash = createHash('sha256').update(fullText).digest('hex');

      // 同一版本、同一抽取内容不需要重新消耗 Embedding 额度。
      if (
        document.fileVersionId === version.id &&
        document.indexStatus === 'indexed' &&
        document.contentHash === contentHash
      ) {
        return { status: 'skipped' };
      }

      const vectors = await this.createEmbeddingsWithRetry(chunks.map((chunk) => chunk.content));

      await this.prisma.$transaction(async (tx) => {
        const saved = await tx.document.update({
          where: { id: document.id },
          data: {
            title: version.file.name,
            contentHash,
            workspaceId: version.file.workspaceId,
            fileId: version.fileId,
            fileVersionId: version.id,
            metadata: {
              originalName: version.file.name,
              mimeType: version.mimeType,
              size: Number(version.size),
              kind: extracted.kind,
            },
          },
        });

        await tx.documentChunk.deleteMany({ where: { documentId: saved.id } });

        for (const [index, chunk] of chunks.entries()) {
          const vector = vectors[index];
          if (!vector) throw new Error(`第 ${index} 个 chunk 缺少向量`);
          await tx.$executeRaw`
            INSERT INTO "document_chunks"
              ("id", "document_id", "chunk_index", "content", "heading_path", "metadata", "embedding")
            VALUES (
              ${crypto.randomUUID()},
              ${saved.id},
              ${index},
              ${chunk.content},
              ${JSON.stringify(chunk.headingPath ?? [])}::jsonb,
              ${JSON.stringify(chunk.metadata ?? {})}::jsonb,
              ${`[${vector.join(',')}]`}::vector
            )
          `;
        }
      });

      await this.prisma.document.update({
        where: { id: document.id },
        data: {
          indexStatus: 'indexed',
          indexedAt: new Date(),
          indexError: null,
        },
      });

      this.logger.log(
        `[document-index] completed: ${JSON.stringify({
          fileId: version.fileId,
          fileVersionId: version.id,
          chunks: chunks.length,
        })}`,
      );
      return { status: 'indexed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : '知识库索引失败';
      await this.prisma.document.update({
        where: { id: document.id },
        data: { indexStatus: 'failed', indexError: message.slice(0, 1000) },
      });
      this.logger.error(
        `[document-index] failed: ${JSON.stringify({
          fileId: version.fileId,
          fileVersionId,
          error: JSON.parse(formatSafeError(error)),
        })}`,
      );
      throw error;
    }
  }

  /** 统一不同来源：Markdown 有标题路径，纯文本/PDF 带 page 溯源。 */
  private buildChunks(
    pages: Array<{ pageNumber: number; text: string }>,
    kind: 'markdown' | 'text' | 'pdf',
  ): Array<TextChunk & { headingPath?: string[]; metadata?: Record<string, unknown> }> {
    const chunks: Array<
      TextChunk & { headingPath?: string[]; metadata?: Record<string, unknown> }
    > = [];

    for (const page of pages) {
      const baseChunks =
        kind === 'markdown' && page.pageNumber === 1
          ? chunkMarkdown(page.text).map((chunk) => ({
              content: chunk.content,
              startPage: page.pageNumber,
              endPage: page.pageNumber,
              headingPath: chunk.headingPath,
            }))
          : chunkPlainText(page.text).map((chunk) => ({
              content: chunk.content,
              startPage: page.pageNumber,
              endPage: page.pageNumber,
            }));

      for (const chunk of baseChunks) {
        chunks.push({
          ...chunk,
          metadata: {
            startPage: chunk.startPage,
            endPage: chunk.endPage,
          },
        });
      }
    }
    return chunks;
  }

  private async createEmbeddingsWithRetry(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(start, start + EMBEDDING_BATCH_SIZE);
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          vectors.push(...(await this.embeddingService.createEmbeddings(batch)));
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, EMBEDDING_RETRY_DELAY_MS * attempt));
        }
      }
      if (lastError) throw lastError;
    }
    return vectors;
  }
}
