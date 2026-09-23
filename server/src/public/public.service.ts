import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { RedisService } from '../redis/redis.service';
import { Response } from 'express';

@Injectable()
export class PublicService {
  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private redisService: RedisService,
  ) {}

  async getFileMeta(urlKey: string) {
    const file = await this.prisma.file.findFirst({
      where: {
        urlKey,
        deletedAt: null,
        visibility: 'public',
        workspace: { status: 'active' },
      },
      select: {
        id: true,
        name: true,
        urlKey: true,
        mimeType: true,
        createdAt: true,
        currentVersion: {
          select: { storageKey: true },
        },
      },
    });

    if (!file) {
      throw new NotFoundException('文件不存在或已删除');
    }

    const fileUrl = await this.s3Service.generatePresignedGetUrl(
      file.currentVersion?.storageKey || '',
      3600,
    );

    return {
      id: file.id,
      originalName: file.name,
      urlKey: file.urlKey,
      mimeType: file.mimeType,
      createdAt: file.createdAt,
      fileUrl,
    };
  }

  async recordView(urlKey: string, ip: string) {
    const file = await this.prisma.file.findFirst({
      where: { urlKey, deletedAt: null, workspace: { status: 'active' } },
      select: { id: true },
    });

    if (!file) {
      throw new NotFoundException('文件不存在');
    }

    await this.redisService.incr(`file:${file.id}:views`);

    await this.prisma.accessLog.create({
      data: {
        fileId: file.id,
        ip,
        action: 'view',
      },
    });

    return { message: 'ok' };
  }

  async getFileContent(urlKey: string, res: Response): Promise<boolean> {
    const file = await this.prisma.file.findFirst({
      where: {
        urlKey,
        deletedAt: null,
        visibility: 'public',
        workspace: { status: 'active' },
      },
      select: {
        id: true,
        mimeType: true,
        name: true,
        currentVersion: {
          select: { storageKey: true },
        },
      },
    });

    if (!file) {
      return false;
    }

    const s3Object = await this.s3Service.getObject(file.currentVersion?.storageKey || '');
    if (!s3Object || !s3Object.Body) {
      return false;
    }

    const contentDisposition = `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`;
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', contentDisposition);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const stream = s3Object.Body as NodeJS.ReadableStream;
    stream.pipe(res);

    return true;
  }

  async getDownloadUrl(urlKey: string, ip: string) {
    const file = await this.prisma.file.findFirst({
      where: {
        urlKey,
        deletedAt: null,
        visibility: 'public',
        workspace: { status: 'active' },
      },
      include: { currentVersion: true },
    });

    if (!file) {
      throw new NotFoundException('文件不存在或已删除');
    }

    await this.redisService.incr(`file:${file.id}:downloads`);

    await this.prisma.accessLog.create({
      data: {
        fileId: file.id,
        ip,
        action: 'download',
      },
    });

    const downloadUrl = await this.s3Service.generatePresignedGetUrl(
      file.currentVersion?.storageKey || '',
      3600,
    );

    return { downloadUrl };
  }
}
