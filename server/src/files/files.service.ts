import {
  BadRequestException,
  ConflictException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { RedisService } from '../redis/redis.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { UploadCallbackDto } from './dto/upload-callback.dto';
import { InitMultipartDto } from './dto/init-multipart.dto';
import { CompleteMultipartDto } from './dto/complete-multipart.dto';

const UPLOAD_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

interface MultipartUploadState {
  userId: string;
  storageKey: string;
  filename: string;
  contentType: string;
  totalSize: number;
}

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
    private redisService: RedisService,
  ) {}

  private async getPersonalWorkspace(userId: string) {
    const membership = await this.prisma.workspaceMember.findFirst({
      where: { userId, role: 'OWNER', status: 'active' },
      select: {
        workspaceId: true,
        workspace: { select: { quota: true } },
      },
    });

    if (!membership) {
      throw new BadRequestException('WORKSPACE_NOT_FOUND');
    }

    return {
      workspaceId: membership.workspaceId,
      quota: membership.workspace.quota,
    };
  }

  private async generateStorageKey(userId: string, filename: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uuid = crypto.randomUUID().slice(0, 8);
    const extension = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
    const baseName = filename.replace(/\.[^.]+$/, '');
    return `${userId}/${year}/${month}/${baseName}-${uuid}${extension}`;
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
    const extension = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
    const urlKey = `${this.generateRandomName()}${extension}`;
    const exists = await this.prisma.file.findUnique({ where: { urlKey }, select: { id: true } });
    return exists ? `${this.generateRandomName()}${extension}` : urlKey;
  }

  private assertQuota(
    quota: { usedSize: bigint; totalSize: bigint; maxFileSize: bigint } | null,
    size: number,
  ) {
    if (!quota) {
      throw new BadRequestException('???????');
    }
    if (
      BigInt(size) > quota.maxFileSize ||
      Number(quota.usedSize) + size > Number(quota.totalSize)
    ) {
      throw new PayloadTooLargeException('??????');
    }
  }

  private async createFileWithVersion(input: {
    workspaceId: string;
    userId: string;
    filename: string;
    contentType: string;
    storageKey: string;
    size: number;
    urlKey?: string;
  }) {
    const urlKey = input.urlKey || (await this.generateUrlKey(input.filename));
    const file = await this.prisma.file.create({
      data: {
        workspaceId: input.workspaceId,
        createdBy: input.userId,
        updatedBy: input.userId,
        name: input.filename,
        mimeType: input.contentType,
        size: BigInt(input.size),
        urlKey,
        visibility: 'public',
      },
    });
    const version = await this.prisma.fileVersion.create({
      data: {
        fileId: file.id,
        versionNo: 1,
        storageKey: input.storageKey,
        size: BigInt(input.size),
        mimeType: input.contentType,
        createdBy: input.userId,
      },
    });
    await this.prisma.file.update({
      where: { id: file.id },
      data: { currentVersionId: version.id, hash: version.hash },
    });

    return { ...file, currentVersionId: version.id };
  }

  async presignUpload(userId: string, dto: PresignUploadDto) {
    if (dto.fileSize > UPLOAD_SIZE_LIMIT) {
      throw new PayloadTooLargeException('???? 5MB????????');
    }

    const workspace = await this.getPersonalWorkspace(userId);
    this.assertQuota(workspace.quota, dto.fileSize);
    const storageKey = await this.generateStorageKey(userId, dto.filename);
    const uploadUrl = await this.s3Service.generatePresignedPutUrl(storageKey, dto.contentType);

    return { uploadUrl, storageKey, workspaceId: workspace.workspaceId };
  }

  async handleUploadCallback(userId: string, dto: UploadCallbackDto, _ip: string) {
    const head = await this.s3Service.headObject(dto.storageKey);
    if (!head) {
      throw new BadRequestException('????????');
    }

    const urlKey = dto.urlKey || (await this.generateUrlKey(dto.filename));
    const existingFile = await this.prisma.file.findUnique({ where: { urlKey } });
    if (existingFile) {
      throw new ConflictException('??????');
    }

    const workspace = await this.getPersonalWorkspace(userId);
    const file = await this.createFileWithVersion({
      workspaceId: workspace.workspaceId,
      userId,
      filename: dto.filename,
      contentType: dto.contentType,
      storageKey: dto.storageKey,
      size: Number(head.ContentLength || dto.fileSize),
      urlKey,
    });

    await this.prisma.workspaceQuota.update({
      where: { workspaceId: workspace.workspaceId },
      data: { usedSize: { increment: BigInt(Number(head.ContentLength || dto.fileSize)) } },
    });

    return {
      id: file.id,
      originalName: file.name,
      urlKey: file.urlKey,
      fileSize: Number(file.size),
      mimeType: file.mimeType,
      createdAt: file.createdAt,
    };
  }

  async initMultipartUpload(userId: string, dto: InitMultipartDto) {
    const workspace = await this.getPersonalWorkspace(userId);
    this.assertQuota(workspace.quota, dto.totalSize);
    const storageKey = await this.generateStorageKey(userId, dto.filename);
    const result = await this.s3Service.createMultipartUpload(storageKey, dto.contentType);

    if (!result.UploadId) {
      throw new BadRequestException('????????');
    }

    const state: MultipartUploadState = {
      userId,
      storageKey,
      filename: dto.filename,
      contentType: dto.contentType,
      totalSize: dto.totalSize,
    };
    await this.redisService.set(`multipart:${result.UploadId}`, JSON.stringify(state), 86400);

    return { uploadId: result.UploadId, storageKey };
  }

  async uploadPart(uploadId: string, partNumber: number, body: Buffer) {
    const state = await this.getMultipartState(uploadId);
    const result = await this.s3Service.uploadPart(state.storageKey, uploadId, partNumber, body);

    return { partNumber, etag: result.ETag };
  }

  async completeMultipartUpload(userId: string, dto: CompleteMultipartDto) {
    const state = await this.getMultipartState(dto.uploadId);
    if (state.userId !== userId) {
      throw new BadRequestException('???????');
    }

    await this.s3Service.completeMultipartUpload(
      state.storageKey,
      dto.uploadId,
      dto.parts.map((part) => ({ ETag: part.etag, PartNumber: part.partNumber })),
    );

    const workspace = await this.getPersonalWorkspace(userId);
    const file = await this.createFileWithVersion({
      workspaceId: workspace.workspaceId,
      userId,
      filename: state.filename,
      contentType: state.contentType,
      storageKey: state.storageKey,
      size: state.totalSize,
    });

    await this.prisma.workspaceQuota.update({
      where: { workspaceId: workspace.workspaceId },
      data: { usedSize: { increment: BigInt(state.totalSize) } },
    });
    await this.redisService.del(`multipart:${dto.uploadId}`);

    return {
      id: file.id,
      originalName: file.name,
      urlKey: file.urlKey,
      fileSize: Number(file.size),
      mimeType: file.mimeType,
      createdAt: file.createdAt,
    };
  }

  private async getMultipartState(uploadId: string): Promise<MultipartUploadState> {
    const stateJson = await this.redisService.get(`multipart:${uploadId}`);
    if (!stateJson) {
      throw new BadRequestException('?????????????');
    }
    return JSON.parse(stateJson) as MultipartUploadState;
  }

  async getFiles(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { createdBy: userId, deletedAt: null };
    const [files, total] = await Promise.all([
      this.prisma.file.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.file.count({ where }),
    ]);

    return {
      items: files.map((file) => ({
        id: file.id,
        originalName: file.name,
        urlKey: file.urlKey,
        fileSize: Number(file.size),
        mimeType: file.mimeType,
        isPrivate: file.visibility === 'private',
        viewCount: 0,
        downloadCount: 0,
        createdAt: file.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getFile(userId: string, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, createdBy: userId, deletedAt: null },
    });

    if (!file) {
      throw new BadRequestException('?????');
    }

    return {
      ...file,
      originalName: file.name,
      fileSize: Number(file.size),
      isPrivate: file.visibility === 'private',
    };
  }

  async deleteFile(userId: string, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, createdBy: userId, deletedAt: null },
      include: { currentVersion: true },
    });

    if (!file) {
      throw new BadRequestException('?????');
    }

    await this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    if (file.currentVersion) {
      await this.s3Service.deleteObject(file.currentVersion.storageKey);
    }
    await this.prisma.workspaceQuota.update({
      where: { workspaceId: file.workspaceId },
      data: { usedSize: { decrement: file.size } },
    });

    return { message: '?????' };
  }

  async getStats(userId: string) {
    const where = { createdBy: userId, deletedAt: null };
    const [totalFiles, totalSize] = await Promise.all([
      this.prisma.file.count({ where }),
      this.prisma.file.aggregate({ where, _sum: { size: true } }),
    ]);

    return {
      totalFiles,
      totalViews: 0,
      totalDownloads: 0,
      totalSize: Number(totalSize._sum?.size || 0),
    };
  }
}
