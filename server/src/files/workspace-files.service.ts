import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { QueueService } from '../queue/queue.service';
import { WorkspaceActorContext } from '../workspaces/types';

const INDEXABLE_EXTENSIONS = ['md', 'txt', 'pdf'];

export function isIndexableWorkspaceFile(filename: string): boolean {
  const extension = filename.toLowerCase().split('.').pop() ?? '';
  return INDEXABLE_EXTENSIONS.includes(extension);
}

export function serializeWorkspaceFile(
  file: {
    id: string;
    name: string;
    urlKey: string;
    size: bigint;
    mimeType: string;
    visibility: string;
    workspaceId: string;
    createdBy: string;
    createdAt: Date;
  },
  document?: {
    indexStatus: string;
    indexedAt: Date | null;
    indexError: string | null;
  } | null,
) {
  let knowledgeIndexStatus = 'not_applicable';
  if (document) knowledgeIndexStatus = document.indexStatus;
  else if (/\.(md|txt|pdf)$/i.test(file.name)) knowledgeIndexStatus = 'unsupported';

  return {
    id: file.id,
    originalName: file.name,
    urlKey: file.urlKey,
    fileSize: Number(file.size),
    mimeType: file.mimeType,
    isPrivate: file.visibility === 'private',
    workspaceId: file.workspaceId,
    createdBy: file.createdBy,
    createdAt: file.createdAt,
    knowledgeIndex: {
      status: knowledgeIndexStatus,
      indexedAt: document?.indexedAt ?? null,
      error: document?.indexError ?? null,
    },
  };
}

@Injectable()
export class WorkspaceFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly queueService: QueueService,
  ) {}

  async list(actor: WorkspaceActorContext, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = {
      workspaceId: actor.workspaceId,
      deletedAt: null,
    };

    const [files, total] = await Promise.all([
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          name: true,
          urlKey: true,
          size: true,
          mimeType: true,
          visibility: true,
          workspaceId: true,
          createdBy: true,
          createdAt: true,
          documents: {
            select: {
              indexStatus: true,
              indexedAt: true,
              indexError: true,
            },
            take: 1,
          },
        },
      }),
      this.prisma.file.count({ where }),
    ]);

    return {
      items: files.map((file) => serializeWorkspaceFile(file, file.documents[0])),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async get(actor: WorkspaceActorContext, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, workspaceId: actor.workspaceId, deletedAt: null },
      include: { documents: { take: 1 } },
    });

    if (!file) throw new NotFoundException('文件不存在');
    return serializeWorkspaceFile(file, file.documents[0]);
  }

  async delete(actor: WorkspaceActorContext, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, workspaceId: actor.workspaceId, deletedAt: null },
    });

    if (!file) throw new NotFoundException('文件不存在');

    // 网盘文件删除后，不能让 pgvector 继续命中旧内容。
    await this.prisma.document.deleteMany({ where: { fileId: file.id } });

    await this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    if (file.currentVersionId) {
      const version = await this.prisma.fileVersion.findUnique({
        where: { id: file.currentVersionId },
      });
      if (version) {
        // 删除文件时同步移除知识库文档；DocumentChunk 由外键级联删除。
        await this.prisma.document.deleteMany({ where: { fileId: file.id } });

        // 对象存储使用 hash 去重；只有最后一个引用才允许物理删除。
        const storageObject = await this.prisma.storageObject.findFirst({
          where: {
            storageDriver: this.storageService.driverName,
            storageKey: version.storageKey,
            status: 'available',
          },
        });

        if (storageObject && storageObject.referenceCount > 1) {
          await this.prisma.storageObject.update({
            where: { id: storageObject.id },
            data: { referenceCount: { decrement: 1 } },
          });
        } else {
          if (storageObject) {
            await this.prisma.storageObject.update({
              where: { id: storageObject.id },
              data: { status: 'deleted' },
            });
          }
          await this.storageService.deleteObject(version.storageKey);
        }
      }
    }
    await this.prisma.workspaceQuota.update({
      where: { workspaceId: actor.workspaceId },
      data: { usedSize: { decrement: file.size } },
    });

    return { id: fileId };
  }

  async reindex(actor: WorkspaceActorContext, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, workspaceId: actor.workspaceId, deletedAt: null },
      include: { currentVersion: true },
    });

    if (!file?.currentVersion) throw new NotFoundException('FILE_NOT_FOUND');
    if (!isIndexableWorkspaceFile(file.name)) {
      throw new BadRequestException('DOCUMENT_TYPE_UNSUPPORTED');
    }

    const sourcePath = `workspace-file:${file.id}`;
    const contentHash = file.currentVersion.hash ?? `unhashed:${file.currentVersion.id}`;
    const document = await this.prisma.document.upsert({
      where: { fileId: file.id },
      create: {
        title: file.name,
        sourcePath,
        contentHash,
        workspaceId: actor.workspaceId,
        fileId: file.id,
        fileVersionId: file.currentVersion.id,
        indexStatus: 'pending',
        metadata: {
          originalName: file.name,
          mimeType: file.mimeType,
          source: 'workspace_reindex',
        },
      },
      update: {
        title: file.name,
        contentHash,
        workspaceId: actor.workspaceId,
        fileVersionId: file.currentVersion.id,
        indexStatus: 'pending',
        indexedAt: null,
        indexError: null,
      },
    });

    await this.queueService.addDocumentIndexJob({
      fileId: file.id,
      fileVersionId: file.currentVersion.id,
      workspaceId: actor.workspaceId,
    });

    return {
      fileId: file.id,
      documentId: document.id,
      status: 'pending',
    };
  }

  async stats(actor: WorkspaceActorContext) {
    const where = { workspaceId: actor.workspaceId, deletedAt: null };
    const [totalFiles, totalSize] = await Promise.all([
      this.prisma.file.count({ where }),
      this.prisma.file.aggregate({ where, _sum: { size: true } }),
    ]);

    return {
      totalFiles,
      totalViews: 0,
      totalDownloads: 0,
      totalSize: Number(totalSize._sum.size || 0),
    };
  }
}

export type WorkspaceFileAccessMode = 'preview' | 'download';

function parseByteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!suffix || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return null;
  }
  return { start, end };
}

@Injectable()
export class WorkspaceFileAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async getUrl(
    actor: WorkspaceActorContext,
    fileId: string,
    mode: WorkspaceFileAccessMode,
    ip?: string,
  ) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, workspaceId: actor.workspaceId, deletedAt: null },
      include: { currentVersion: true },
    });

    if (!file?.currentVersion) throw new NotFoundException('FILE_NOT_FOUND');

    const dispositionType = mode === 'download' ? 'attachment' : 'inline';
    const responseContentDisposition = `${dispositionType}; filename*=UTF-8''${encodeURIComponent(
      file.name,
    )}`;
    const isTextLike =
      file.mimeType.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/javascript'].some((type) =>
        file.mimeType.startsWith(type),
      );
    const responseContentType = isTextLike ? `${file.mimeType}; charset=utf-8` : file.mimeType;
    const url = await this.storageService.generatePresignedGetUrl(
      file.currentVersion.storageKey,
      3600,
      responseContentDisposition,
      responseContentType,
    );
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    if (mode === 'download') {
      await this.prisma.accessLog.create({
        data: { fileId: file.id, ip: ip || 'unknown', action: 'download' },
      });
    }

    return {
      url,
      expiresAt,
      filename: file.name,
      mimeType: file.mimeType,
      size: Number(file.size),
      disposition: dispositionType,
    };
  }

  async streamContent(
    actor: WorkspaceActorContext,
    fileId: string,
    res: Response,
    rangeHeader?: string,
  ) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, workspaceId: actor.workspaceId, deletedAt: null },
      include: { currentVersion: true },
    });

    if (!file?.currentVersion) throw new NotFoundException('FILE_NOT_FOUND');

    const isTextLike =
      file.mimeType.startsWith('text/') ||
      ['application/json', 'application/xml', 'application/javascript'].some((type) =>
        file.mimeType.startsWith(type),
      );
    const contentType = isTextLike ? `${file.mimeType}; charset=utf-8` : file.mimeType;
    const range = parseByteRange(rangeHeader, Number(file.size));
    const object = await this.storageService.getObject(
      file.currentVersion.storageKey,
      range ? `bytes=${range.start}-${range.end}` : undefined,
    );

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );

    if (range && object.ContentRange) {
      res.status(206);
      res.setHeader('Content-Range', object.ContentRange);
      res.setHeader('Content-Length', String(object.ContentLength ?? 0));
    } else if (object.ContentLength !== undefined) {
      res.setHeader('Content-Length', String(object.ContentLength));
    }

    const stream = object.Body as NodeJS.ReadableStream;
    stream.pipe(res);
  }
}
