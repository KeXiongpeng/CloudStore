import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { WorkspaceActorContext } from '../workspaces/types';

export function serializeWorkspaceFile(file: {
  id: string;
  name: string;
  urlKey: string;
  size: bigint;
  mimeType: string;
  visibility: string;
  workspaceId: string;
  createdBy: string;
  createdAt: Date;
}) {
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
  };
}

@Injectable()
export class WorkspaceFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
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
        },
      }),
      this.prisma.file.count({ where }),
    ]);

    return {
      items: files.map(serializeWorkspaceFile),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async get(actor: WorkspaceActorContext, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, workspaceId: actor.workspaceId, deletedAt: null },
    });

    if (!file) throw new NotFoundException('文件不存在');
    return serializeWorkspaceFile(file);
  }

  async delete(actor: WorkspaceActorContext, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, workspaceId: actor.workspaceId, deletedAt: null },
    });

    if (!file) throw new NotFoundException('文件不存在');

    await this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    if (file.currentVersionId) {
      const version = await this.prisma.fileVersion.findUnique({
        where: { id: file.currentVersionId },
      });
      if (version) {
        await this.s3Service.deleteObject(version.storageKey);
      }
    }
    await this.prisma.workspaceQuota.update({
      where: { workspaceId: actor.workspaceId },
      data: { usedSize: { decrement: file.size } },
    });

    return { id: fileId };
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
