import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { WorkspaceActorContext } from '../workspaces/types';

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
          originalName: true,
          urlKey: true,
          fileSize: true,
          mimeType: true,
          isPrivate: true,
          workspaceId: true,
          createdBy: true,
          createdAt: true,
        },
      }),
      this.prisma.file.count({ where }),
    ]);

    return {
      items: files.map((file) => ({ ...file, fileSize: Number(file.fileSize) })),
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
    return { ...file, fileSize: Number(file.fileSize) };
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

    await this.s3Service.deleteObject(file.storageKey);
    await this.prisma.userQuota.update({
      where: { userId: actor.userId },
      data: { storageUsed: { decrement: file.fileSize } },
    });

    return { id: fileId };
  }

  async stats(actor: WorkspaceActorContext) {
    const where = { workspaceId: actor.workspaceId, deletedAt: null };
    const [totalFiles, counts, totalSize] = await Promise.all([
      this.prisma.file.count({ where }),
      this.prisma.file.aggregate({
        where,
        _sum: { viewCount: true, downloadCount: true },
      }),
      this.prisma.file.aggregate({ where, _sum: { fileSize: true } }),
    ]);

    return {
      totalFiles,
      totalViews: counts._sum.viewCount || 0,
      totalDownloads: counts._sum.downloadCount || 0,
      totalSize: Number(totalSize._sum.fileSize || 0),
    };
  }
}
