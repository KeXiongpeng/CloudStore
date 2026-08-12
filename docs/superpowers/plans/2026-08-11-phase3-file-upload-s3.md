# Phase 3: 后端文件上传 + S3 对接 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现混合模式文件上传（小文件前端直传 + 大文件后端中转分片），对接七牛云 S3，包含配额检查、元数据记录、文件列表查询、文件删除和访问统计。

**Architecture:** FilesModule 负责所有文件操作。S3Service 封装七牛云 S3 操作（Presigned URL、分片上传）。小文件（≤5MB）通过 Presigned PUT URL 让前端直传七牛云，后端仅生成凭证和记录元数据。大文件（>5MB）通过后端中转，使用 S3 Multipart Upload API 分片上传。

**Tech Stack:** NestJS 10, TypeScript, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, Prisma ORM, PostgreSQL 16, Redis 7

## Global Constraints

- 前端: React + Next.js (App Router) + TailwindCSS + TypeScript
- 后端: NestJS + TypeScript + Prisma ORM
- 数据库: PostgreSQL 16
- 缓存: Redis 7
- 对象存储: 七牛云 S3 兼容接口（@aws-sdk/client-s3）
- 部署: Docker Compose + Nginx
- 所有环境变量通过 .env 管理
- Prisma Schema 已定义：files 表、user_quotas 表
- 认证系统已完成：JwtAuthGuard、@CurrentUser() 可用
- NestJS 全局前缀 `/api`，端口 3000
- 上传阈值：≤5MB 前端直传，>5MB 后端中转分片（每片 2MB）

## Prerequisites

Phase 1 和 Phase 2 必须已完成：NestJS 脚手架、Prisma Schema、认证系统、PrismaModule、RedisModule。

---

## File Structure Overview

```
server/src/
├── app.module.ts                    # 修改：导入 S3Module, FilesModule
├── common/
│   └── config/
│       └── configuration.ts        # 已有 qiniu 配置
├── s3/
│   ├── s3.module.ts                # S3 模块
│   └── s3.service.ts               # S3 服务（封装七牛云操作）
├── files/
│   ├── files.module.ts             # 文件模块
│   ├── files.controller.ts         # 文件控制器
│   ├── files.service.ts            # 文件服务
│   └── dto/
│       ├── presign-upload.dto.ts       # 直传凭证请求 DTO
│       ├── upload-callback.dto.ts      # 直传完成回调 DTO
│       ├── init-multipart.dto.ts      # 分片上传初始化 DTO
│       ├── complete-multipart.dto.ts  # 分片合并完成 DTO
│       └── query-files.dto.ts        # 文件列表查询 DTO
```

---

### Task 1: S3 模块 — 封装七牛云 S3 操作

**Files:**
- Modify: `server/package.json`（新增 @aws-sdk 依赖）
- Create: `server/src/s3/s3.module.ts`
- Create: `server/src/s3/s3.service.ts`

**Interfaces:**
- Consumes: `configuration.ts` 中的 `qiniu` 配置（accessKey, secretKey, bucket, endpoint）
- Produces: `S3Service.generatePresignedPutUrl(key, contentType, ttl)` — 生成直传 URL
- Produces: `S3Service.createMultipartUpload(key, contentType)` — 初始化分片上传
- Produces: `S3Service.uploadPart(bucket, key, uploadId, partNumber, body)` — 上传分片
- Produces: `S3Service.completeMultipartUpload(bucket, key, uploadId, parts)` — 合并分片
- Produces: `S3Service.getPresignedGetObjectUrl(key)` — 获取文件下载/预览 URL
- Produces: `S3Service.deleteObject(key)` — 删除文件
- Produces: `S3Service.headObject(key)` — 获取文件元数据

- [ ] **Step 1: 修改 `server/package.json` 新增 S3 依赖**

在 `dependencies` 中添加：

```json
"@aws-sdk/client-s3": "^3.515.0",
"@aws-sdk/s3-request-presigner": "^3.515.0"
```

- [ ] **Step 2: 创建 `server/src/s3/s3.service.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private client: S3Client;
  private bucket: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.get<string>('qiniu.endpoint');
    const region = 'cn-east-1';
    const accessKey = this.configService.get<string>('qiniu.accessKey');
    const secretKey = this.configService.get<string>('qiniu.secretKey');

    this.bucket = this.configService.get<string>('qiniu.bucket');

    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });
  }

  async generatePresignedPutUrl(
    key: string,
    contentType: string,
    ttlSeconds: number = 300,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async generatePresignedGetUrl(
    key: string,
    ttlSeconds: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async createMultipartUpload(key: string, contentType: string) {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return this.client.send(command);
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ) {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
    });

    const response = await this.client.send(command);
    return {
      ETag: response.ETag,
      PartNumber: partNumber,
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ) {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    });

    return this.client.send(command);
  }

  async deleteObject(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return this.client.send(command);
  }

  async headObject(key: string) {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      return await this.client.send(command);
    } catch (error) {
      return null;
    }
  }
}
```

注意：`generatePresignedGetUrl` 方法中用到了 `GetObjectCommand`，需要在文件顶部的 import 中添加：

```typescript
import {
  // ... 已有 imports
  GetObjectCommand,
} from '@aws-sdk/client-s3';
```

- [ ] **Step 3: 创建 `server/src/s3/s3.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';

@Module({
  providers: [S3Service],
  exports: [S3Service],
})
export class S3Module {}
```

- [ ] **Step 4: 提交**

```bash
git add server/
git commit -m "feat: add S3Module with Qiniu S3 operations (presign, multipart, delete)"
```

---

### Task 2: FilesModule — 小文件前端直传（Presigned URL + Callback）

**Files:**
- Create: `server/src/files/dto/presign-upload.dto.ts`
- Create: `server/src/files/dto/upload-callback.dto.ts`
- Create: `server/src/files/files.module.ts`
- Create: `server/src/files/files.service.ts`
- Create: `server/src/files/files.controller.ts`
- Modify: `server/src/app.module.ts`（导入 FilesModule + S3Module）

**Interfaces:**
- Consumes: `S3Service`（Task 1）
- Consumes: `PrismaService`（Phase 2）
- Consumes: `JwtAuthGuard` + `@CurrentUser()`（Phase 2）
- Produces: `POST /api/files/presign` — 返回 Presigned PUT URL
- Produces: `POST /api/files/callback` — 接收前端直传完成回调，记录元数据

- [ ] **Step 1: 创建 `server/src/files/dto/presign-upload.dto.ts`**

```typescript
import { IsNotEmpty, IsNumber, IsString, Max } from 'class-validator';

export class PresignUploadDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsNumber()
  @Max(5242880, { message: '文件大小超过 5MB 限制，请使用分片上传' })
  fileSize: number;
}
```

- [ ] **Step 2: 创建 `server/src/files/dto/upload-callback.dto.ts`**

```typescript
import { IsNotEmpty, IsString, IsNumber, IsOptional } from 'class-validator';

export class UploadCallbackDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsNumber()
  fileSize: number;

  @IsNotEmpty()
  @IsString()
  storageKey: string;

  @IsOptional()
  @IsString()
  urlKey?: string;
}
```

- [ ] **Step 3: 创建 `server/src/files/files.service.ts`**

```typescript
import {
  Injectable,
  BadRequestException,
  PayloadTooLargeException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { UploadCallbackDto } from './dto/upload-callback.dto';
import { Request } from 'express';

const UPLOAD_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private s3Service: S3Service,
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

  private async generateUrlKey(filename: string): Promise<string> {
    let urlKey = filename;
    let counter = 1;

    while (true) {
      const exists = await this.prisma.file.findUnique({
        where: { urlKey },
        select: { id: true },
      });

      if (!exists) {
        return urlKey;
      }

      const ext = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
      const baseName = filename.replace(/\.[^.]+$/, '');
      urlKey = counter === 1 ? `${baseName}-1${ext}` : `${baseName}-${counter}${ext}`;
      counter++;
    }
  }

  async presignUpload(userId: string, dto: PresignUploadDto) {
    if (dto.fileSize > UPLOAD_SIZE_LIMIT) {
      throw new PayloadTooLargeException('文件超过 5MB，请使用分片上传');
    }

    // 检查配额
    const quota = await this.prisma.userQuota.findUnique({
      where: { userId },
    });

    if (!quota) {
      throw new BadRequestException('配额信息不存在，请先注册');
    }

    if (quota.storageUsed + dto.fileSize > quota.storageLimit) {
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
    // 验证文件是否存在于 S3
    const head = await this.s3Service.headObject(dto.storageKey);
    if (!head) {
      throw new BadRequestException('文件上传验证失败');
    }

    // 检查 URL Key 唯一性并生成
    const urlKey = dto.urlKey || (await this.generateUrlKey(dto.filename));

    const existingFile = await this.prisma.file.findUnique({
      where: { urlKey },
    });
    if (existingFile) {
      throw new ConflictException('文件名已存在');
    }

    // 记录元数据
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

    // 更新配额
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

    // 软删除
    await this.prisma.file.update({
      where: { id: fileId },
      data: { deletedAt: new Date() },
    });

    // 从 S3 删除
    await this.s3Service.deleteObject(file.storageKey);

    // 更新配额
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
```

- [ ] **Step 4: 创建 `server/src/files/files.controller.ts`**

```typescript
import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  ParseIntPipe,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { UploadCallbackDto } from './dto/upload-callback.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Request } from 'express';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('presign')
  presignUpload(
    @CurrentUser('id') userId: string,
    @Body() dto: PresignUploadDto,
  ) {
    return this.filesService.presignUpload(userId, dto);
  }

  @Post('callback')
  uploadCallback(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadCallbackDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
    return this.filesService.handleUploadCallback(userId, dto, ip);
  }

  @Get()
  getFiles(
    @CurrentUser('id') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    return this.filesService.getFiles(userId, page, limit);
  }

  @Get('stats')
  getStats(@CurrentUser('id') userId: string) {
    return this.filesService.getStats(userId);
  }

  @Get(':id')
  getFile(
    @CurrentUser('id') userId: string,
    @Param('id') fileId: string,
  ) {
    return this.filesService.getFile(userId, fileId);
  }

  @Delete(':id')
  deleteFile(
    @CurrentUser('id') userId: string,
    @Param('id') fileId: string,
  ) {
    return this.filesService.deleteFile(userId, fileId);
  }
}
```

- [ ] **Step 5: 创建 `server/src/files/files.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';

@Module({
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
```

- [ ] **Step 6: 修改 `server/src/app.module.ts` 导入 S3Module 和 FilesModule**

```typescript
import { S3Module } from './s3/s3.module';
import { FilesModule } from './files/files.module';

@Module({
  imports: [
    // ... 已有模块
    S3Module,
    FilesModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: 提交**

```bash
git add server/
git commit -m "feat: add FilesModule with presigned upload, callback, file list, delete"
```

---

### Task 3: 大文件分片上传（后端中转）

**Files:**
- Create: `server/src/files/dto/init-multipart.dto.ts`
- Create: `server/src/files/dto/complete-multipart.dto.ts`
- Modify: `server/src/files/files.service.ts`（新增分片上传方法）
- Modify: `server/src/files/files.controller.ts`（新增分片上传路由）

**Interfaces:**
- Consumes: `S3Service`（Task 1）
- Consumes: `RedisService`（Phase 2）— 缓存分片上传状态
- Produces: `POST /api/files/upload-init` — 初始化分片上传，返回 uploadId
- Produces: `POST /api/files/upload-part` — 上传单个分片
- Produces: `POST /api/files/upload-complete` — 合并所有分片

- [ ] **Step 1: 创建 `server/src/files/dto/init-multipart.dto.ts`**

```typescript
import { IsNotEmpty, IsString, IsNumber } from 'class-validator';

export class InitMultipartDto {
  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsNumber()
  totalSize: number;
}
```

- [ ] **Step 2: 创建 `server/src/files/dto/complete-multipart.dto.ts`**

```typescript
import { IsNotEmpty, IsString, IsArray, ValidateNested, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

class MultipartPartDto {
  @IsNumber()
  partNumber: number;

  @IsString()
  etag: string;
}

export class CompleteMultipartDto {
  @IsNotEmpty()
  @IsString()
  uploadId: string;

  @IsNotEmpty()
  @IsString()
  filename: string;

  @IsNotEmpty()
  @IsString()
  contentType: string;

  @IsNotEmpty()
  @IsNumber()
  totalSize: number;

  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MultipartPartDto)
  parts: MultipartPartDto[];
}
```

- [ ] **Step 3: 修改 `server/src/files/files.service.ts` 新增分片上传方法**

在 `FilesService` 类中新增以下方法（需要注入 RedisService）：

```typescript
import { RedisService } from '../redis/redis.service';

// constructor 中添加 RedisService:
// constructor(
//   private prisma: PrismaService,
//   private s3Service: S3Service,
//   private redisService: RedisService,
// ) {}

async initMultipartUpload(userId: string, dto: InitMultipartDto) {
  // 检查配额
  const quota = await this.prisma.userQuota.findUnique({
    where: { userId },
  });

  if (!quota) {
    throw new BadRequestException('配额信息不存在');
  }

  if (quota.storageUsed + dto.totalSize > quota.storageLimit) {
    throw new PayloadTooLargeException('存储空间不足');
  }

  const storageKey = await this.generateStorageKey(userId, dto.filename);

  const result = await this.s3Service.createMultipartUpload(
    storageKey,
    dto.contentType,
  );

  const uploadId = result.UploadId;

  // 缓存分片上传状态（24小时过期）
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
  // 获取上传状态
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

  // 更新分片状态
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
  // 验证上传状态
  const stateJson = await this.redisService.get(`multipart:${dto.uploadId}`);
  if (!stateJson) {
    throw new BadRequestException('分片上传会话不存在或已过期');
  }

  const state = JSON.parse(stateJson);

  if (state.userId !== userId) {
    throw new BadRequestException('无权操作此上传');
  }

  // 合并分片
  await this.s3Service.completeMultipartUpload(
    state.storageKey,
    dto.uploadId,
    dto.parts,
  );

  // 生成 URL Key
  const urlKey = await this.generateUrlKey(dto.filename);

  // 记录元数据
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

  // 更新配额
  await this.prisma.userQuota.update({
    where: { userId },
    data: {
      storageUsed: {
        increment: dto.totalSize,
      },
    },
  });

  // 清除分片缓存
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
```

- [ ] **Step 4: 修改 `server/src/files/files.controller.ts` 新增分片上传路由**

```typescript
import { InitMultipartDto } from './dto/init-multipart.dto';
import { CompleteMultipartDto } from './dto/complete-multipart.dto';
import { UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

// 在 FilesController 中添加：

@Post('upload-init')
initMultipartUpload(
  @CurrentUser('id') userId: string,
  @Body() dto: InitMultipartDto,
) {
  return this.filesService.initMultipartUpload(userId, dto);
}

@Post('upload-part')
@UseInterceptors(
  FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB per part
  }),
)
async uploadPart(
  @CurrentUser('id') userId: string,
  @Body('uploadId') uploadId: string,
  @Body('partNumber', ParseIntPipe) partNumber: number,
  @UploadedFile() file: Express.Multer.File,
) {
  if (!file) {
    throw new BadRequestException('请上传文件分片');
  }

  return this.filesService.uploadPart(uploadId, partNumber, file.buffer);
}

@Post('upload-complete')
async completeMultipartUpload(
  @CurrentUser('id') userId: string,
  @Body() dto: CompleteMultipartDto,
) {
  return this.filesService.completeMultipartUpload(userId, dto);
}
```

注意：需要在 `files.controller.ts` 顶部 import 中添加：

```typescript
import { UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
```

- [ ] **Step 5: 修改 `server/src/files/files.module.ts` 导入 S3Module**

```typescript
import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [S3Module],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
```

注意：`S3Module` 也在 `AppModule` 中全局导入过了，但此处显式导入使依赖关系更清晰。

- [ ] **Step 6: 提交**

```bash
git add server/
git commit -m "feat: add multipart upload for large files (>5MB) with backend relay"
```

---

## 验证清单

完成所有 Task 后，执行以下验证：

1. **安装新增依赖：**
   ```bash
   cd server && npm install
   ```

2. **启动服务：**
   ```bash
   cd server && npm run start:dev
   ```

3. **验证小文件直传凭证生成（需登录获取 token）：**
   ```bash
   # 先注册/登录获取 token
   TOKEN=<access_token>

   curl -X POST http://localhost:3000/api/files/presign \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"filename":"test.jpg","contentType":"image/jpeg","fileSize":102400}'
   ```
   预期：返回 `{ uploadUrl: "https://...", storageKey: "..." }`

4. **验证直传回调：**
   ```bash
   curl -X POST http://localhost:3000/api/files/callback \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"filename":"test.jpg","contentType":"image/jpeg","fileSize":102400,"storageKey":"<storageKey>"}'
   ```
   预期：返回文件元数据 `{ id, originalName, urlKey, fileSize, mimeType, createdAt }`

5. **验证文件列表：**
   ```bash
   curl http://localhost:3000/api/files?page=1&limit=10 \
     -H "Authorization: Bearer $TOKEN"
   ```
   预期：返回 `{ items: [...], total, page, limit, totalPages }`

6. **验证文件统计：**
   ```bash
   curl http://localhost:3000/api/files/stats \
     -H "Authorization: Bearer $TOKEN"
   ```
   预期：返回 `{ totalFiles, totalViews, totalDownloads, totalSize }`

7. **验证文件删除：**
   ```bash
   curl -X DELETE http://localhost:3000/api/files/<fileId> \
     -H "Authorization: Bearer $TOKEN"
   ```
   预期：返回 `{ message: "文件已删除" }`

8. **验证分片上传初始化：**
   ```bash
   curl -X POST http://localhost:3000/api/files/upload-init \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"filename":"large-video.mp4","contentType":"video/mp4","totalSize":10485760}'
   ```
   预期：返回 `{ uploadId, storageKey }`
