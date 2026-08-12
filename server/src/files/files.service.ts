import {
  Injectable,
  BadRequestException,
  PayloadTooLargeException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { RedisService } from '../redis/redis.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { UploadCallbackDto } from './dto/upload-callback.dto';
import { InitMultipartDto } from './dto/init-multipart.dto';
import { CompleteMultipartDto } from './dto/complete-multipart.dto';
import { Request } from 'express';

const UPLOAD_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private redisService: RedisService,
  ) {}

  private async generateStorageKey(userId: string, filename: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID().slice(0, 8);
    const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
    const baseName = filename.replace(/\.[^.]+$/, '');
    return `${userId}/${year}/${month}/${baseName}-${uuid}${ext}`;
  }

  private generateRandomName(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  }

  private async generateUrlKey(filename: string): Promise<string> {
    const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
    let urlKey: string;
    let counter = 1;

    while (true) {
      urlKey = counter === 1
        ? `${this.generateRandomName()}${ext}`
        : `${this.generateRandomName()}${ext}`;
      counter++;

      const exists = await this.prisma.file.findUnique({
        where: { urlKey },
        select: { id: true },
      });

      if (!exists) {
        return urlKey;
      }
    }
  }

  async presignUpload(userId: string, dto: PresignUploadDto) {
    if (dto.fileSize > UPLOAD_SIZE_LIMIT) {
      throw new PayloadTooLargeException('文件超过 5MB，请使用分片上传');
    }

    const quota = await this.prisma.userQuota.findUnique({
      where: { userId },
    });

    if (!quota) {
      throw new BadRequestException('配额信息不存在，请先注册');
    }

    if (Number(quota.storageUsed) + dto.fileSize > Number(quota.storageLimit)) {
      throw new PayloadTooLargeException('存储空间不足');
    }

    const storageKey = await this.generateStorageKey(userId, dto.filename);
    const presignedUrl = await this.s3Service.generatePresignedPutUrl(
      storageKey,
      dto.contentType,
    );

    return {
      uploadUrl: presignedUrl,
      storageKey,
    };
  }

  async handleUploadCallback(userId: string, dto: UploadCallbackDto, ip: string) {
    const head = await this.s3Service.headObject(dto.storageKey);
    if (!head) {
      throw new BadRequestException('文件上传验证失败');
    }

    const urlKey = dto.urlKey || (await this.generateUrlKey(dto.filename));

    const existingFile = await this.prisma.file.findUnique({
      where: { urlKey },
    });
    if (existingFile) {
      throw new ConflictException('文件名已存在');
    }

    const file = await this.prisma.file.create({
      data: {
        userId,
        originalName: dto.filename,
        storageKey: dto.storageKey,
        urlKey,
        fileSize: dto.fileSize,
        mimeType: dto.contentType,
        uploadIp: ip,
      },
    });

    await this.prisma.userQuota.update({
      where: { userId },
      data: {
        storageUsed: {
          increment: dto.fileSize,
        },
      },
    });

    return {
      id: file.id,
      originalName: file.originalName,
      urlKey: file.urlKey,
      fileSize: Number(file.fileSize),
      mimeType: file.mimeType,
      createdAt: file.createdAt,
    };
  }

  async initMultipartUpload(userId: string, dto: InitMultipartDto) {
    const quota = await this.prisma.userQuota.findUnique({
      where: { userId },
    });

    if (!quota) {
      throw new BadRequestException('配额信息不存在');
    }

    if (Number(quota.storageUsed) + dto.totalSize > Number(quota.storageLimit)) {
      throw new PayloadTooLargeException('存储空间不足');
    }

    const storageKey = await this.generateStorageKey(userId, dto.filename);

    const result = await this.s3Service.createMultipartUpload(
      storageKey,
      dto.contentType,
    );

    const uploadId = result.UploadId;

    await this.redisService.set(
      `multipart:${uploadId}`,
      JSON.stringify({
        userId,
        storageKey,
        filename: dto.filename,
        contentType: dto.contentType,
        totalSize: dto.totalSize,
        parts: [],
      }),
      86400,
    );

    return {
      uploadId,
      storageKey,
    };
  }

  async uploadPart(uploadId: string, partNumber: number, body: Buffer) {
    const stateJson = await this.redisService.get(`multipart:${uploadId}`);
    if (!stateJson) {
      throw new BadRequestException('分片上传会话不存在或已过期');
    }

    const state = JSON.parse(stateJson);

    const result = await this.s3Service.uploadPart(
      state.storageKey,
      uploadId,
      partNumber,
      body,
    );

    state.parts.push({
      partNumber,
      etag: result.ETag,
    });
    await this.redisService.set(
      `multipart:${uploadId}`,
      JSON.stringify(state),
      86400,
    );

    return {
      partNumber,
      etag: result.ETag,
    };
  }

  async completeMultipartUpload(userId: string, dto: CompleteMultipartDto) {
    const stateJson = await this.redisService.get(`multipart:${dto.uploadId}`);
    if (!stateJson) {
      throw new BadRequestException('分片上传会话不存在或已过期');
    }

    const state = JSON.parse(stateJson);

    if (state.userId !== userId) {
      throw new BadRequestException('无权操作此上传');
    }

    await this.s3Service.completeMultipartUpload(
      state.storageKey,
      dto.uploadId,
      dto.parts.map((p) => ({ ETag: p.etag, PartNumber: p.partNumber })),
    );

    const urlKey = await this.generateUrlKey(dto.filename);

    const file = await this.prisma.file.create({
      data: {
        userId,
        originalName: dto.filename,
        storageKey: state.storageKey,
        urlKey,
        fileSize: dto.totalSize,
        mimeType: dto.contentType,
      },
    });

    await this.prisma.userQuota.update({
      where: { userId },
      data: {
        storageUsed: {
          increment: dto.totalSize,
        },
      },
    });

    await this.redisService.del(`multipart:${dto.uploadId}`);

    return {
      id: file.id,
      originalName: file.originalName,
      urlKey: file.urlKey,
      fileSize: Number(file.fileSize),
      mimeType: file.mimeType,
      createdAt: file.createdAt,
    };
  }

  async getFiles(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [files, total] = await Promise.all([
      this.prisma.file.findMany({
        where: {
          userId,
          deletedAt: null,
        },
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
          viewCount: true,
          downloadCount: true,
          createdAt: true,
        },
      }),
      this.prisma.file.count({
        where: {
          userId,
          deletedAt: null,
        },
      }),
    ]);

    return {
      items: files.map((f) => ({
        ...f,
        fileSize: Number(f.fileSize),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFile(userId: string, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: {
        id: fileId,
        userId,
        deletedAt: null,
      },
    });

    if (!file) {
      throw new BadRequestException('文件不存在');
    }

    return {
      ...file,
      fileSize: Number(file.fileSize),
    };
  }

  async deleteFile(userId: string, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: {
        id: fileId,
        userId,
        deletedAt: null,
      },
    });

    if (!file) {
      throw new BadRequestException('文件不存在');
    }

    await this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    await this.s3Service.deleteObject(file.storageKey);

    await this.prisma.userQuota.update({
      where: { userId },
      data: {
        storageUsed: {
          decrement: Number(file.fileSize),
        },
      },
    });

    return { message: '文件已删除' };
  }

  async getStats(userId: string) {
    const totalFiles = await this.prisma.file.count({
      where: { userId, deletedAt: null },
    });

    const totalViews = await this.prisma.file.aggregate({
      where: { userId, deletedAt: null },
      _sum: { viewCount: true, downloadCount: true },
    });

    const totalSize = await this.prisma.file.aggregate({
      where: { userId, deletedAt: null },
      _sum: { fileSize: true },
    });

    return {
      totalFiles,
      totalViews: totalViews._sum.viewCount || 0,
      totalDownloads: totalViews._sum.downloadCount || 0,
      totalSize: Number(totalSize._sum.fileSize || 0),
    };
  }
}
