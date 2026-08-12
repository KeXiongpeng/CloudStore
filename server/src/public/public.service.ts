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
        isPrivate: false,
      },
      select: {
        id: true,
        originalName: true,
        urlKey: true,
        storageKey: true,
        fileSize: true,
        mimeType: true,
        viewCount: true,
        downloadCount: true,
        createdAt: true,
        user: {
          select: {
            nickname: true,
          },
        },
      },
    });

    if (!file) {
      throw new NotFoundException('文件不存在或已删除');
    }

    const fileUrl = await this.s3Service.generatePresignedGetUrl(file.storageKey, 3600);

    return {
      ...file,
      fileSize: Number(file.fileSize),
      fileUrl,
    };
  }

  async recordView(urlKey: string, ip: string) {
    const file = await this.prisma.file.findFirst({
      where: { urlKey, deletedAt: null },
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

    await this.prisma.file.update({
      where: { id: file.id },
      data: {
        viewCount: {
          increment: 1,
        },
      },
    });

    return { message: 'ok' };
  }

  async getFileContent(urlKey: string, res: Response): Promise<boolean> {
    const file = await this.prisma.file.findFirst({
      where: {
        urlKey,
        deletedAt: null,
        isPrivate: false,
      },
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        originalName: true,
      },
    });

    if (!file) {
      return false;
    }

    const s3Object = await this.s3Service.getObject(file.storageKey);
    if (!s3Object || !s3Object.Body) {
      return false;
    }

    const contentDisposition = `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`;
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
        isPrivate: false,
      },
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

    await this.prisma.file.update({
      where: { id: file.id },
      data: {
        downloadCount: {
          increment: 1,
        },
      },
    });

    const downloadUrl = await this.s3Service.generatePresignedGetUrl(file.storageKey, 3600);

    return { downloadUrl };
  }
}
