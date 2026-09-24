# Phase 4: 后端公共接口 + API 密钥 + 管理后台 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现公共文件预览/下载接口（无需登录）、API 密钥管理（支持 ShareX 集成）、以及管理员后台接口（用户管理、全局统计）。

**Architecture:** PublicModule 处理无需鉴权的公共文件访问。ApiKeysModule 管理 API 密钥的创建/删除/查询，并提供 ApiKeyAuthGuard 用于 ShareX 等工具通过密钥上传。AdminModule 提供管理员专属接口，使用 AdminRoleGuard 保护。

**Tech Stack:** NestJS 10, TypeScript, Prisma ORM, PostgreSQL 16, Redis 7, crypto (SHA-256)

## Global Constraints

- 前端: React + Next.js (App Router) + TailwindCSS + TypeScript
- 后端: NestJS + TypeScript + Prisma ORM
- 数据库: PostgreSQL 16
- 缓存: Redis 7
- 对象存储: 七牛云 S3 兼容接口
- 部署: Docker Compose + Nginx
- 所有环境变量通过 .env 管理
- Prisma Schema 已定义：files, api_keys, access_logs, users, user_quotas 表
- 认证系统已完成：JwtAuthGuard、AdminRoleGuard、@CurrentUser()、@Roles() 可用
- 文件系统已完成：S3Service、FilesService 可用

## Prerequisites

Phase 1-3 必须已完成：NestJS 脚手架、认证系统、文件上传系统、S3Module、RedisModule。

---

## File Structure Overview

```
server/src/
├── app.module.ts                       # 修改：导入 PublicModule, ApiKeysModule, AdminModule
├── common/
│   └── guards/
│       └── api-key.guard.ts           # API Key 认证守卫
├── public/
│   ├── public.module.ts               # 公共接口模块
│   ├── public.controller.ts           # 公共接口控制器
│   └── public.service.ts              # 公共接口服务
├── api-keys/
│   ├── api-keys.module.ts             # API 密钥模块
│   ├── api-keys.controller.ts         # API 密钥控制器
│   └── api-keys.service.ts            # API 密钥服务
└── admin/
    ├── admin.module.ts                # 管理后台模块
    ├── admin.controller.ts            # 管理后台控制器
    └── admin.service.ts               # 管理后台服务
```

---

### Task 1: 公共接口 — 文件预览元数据 + 浏览/下载统计

**Files:**

- Create: `server/src/public/public.module.ts`
- Create: `server/src/public/public.service.ts`
- Create: `server/src/public/public.controller.ts`
- Modify: `server/src/app.module.ts`（导入 PublicModule）

**Interfaces:**

- Consumes: `PrismaService`（Phase 2）
- Consumes: `S3Service`（Phase 3）
- Consumes: `RedisService`（Phase 2）
- Produces: `GET /api/public/files/:urlKey` — 获取文件公开元数据（无需登录）
- Produces: `POST /api/public/files/:urlKey/view` — 记录浏览
- Produces: `GET /api/public/files/:urlKey/download` — 记录下载，重定向到七牛云

- [ ] **Step 1: 创建 `server/src/public/public.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../s3/s3.service';
import { RedisService } from '../redis/redis.service';
import { Request } from 'express';

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

    return {
      ...file,
      fileSize: Number(file.fileSize),
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

    // Redis 计数
    await this.redisService.incr(`file:${file.id}:views`);

    // 异步写入 access_logs
    await this.prisma.accessLog.create({
      data: {
        fileId: file.id,
        ip,
        action: 'view',
      },
    });

    // 更新 files 表计数
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

    // Redis 计数
    await this.redisService.incr(`file:${file.id}:downloads`);

    // 写入 access_logs
    await this.prisma.accessLog.create({
      data: {
        fileId: file.id,
        ip,
        action: 'download',
      },
    });

    // 更新 files 表计数
    await this.prisma.file.update({
      where: { id: file.id },
      data: {
        downloadCount: {
          increment: 1,
        },
      },
    });

    // 生成预签名下载 URL（1小时有效）
    const downloadUrl = await this.s3Service.generatePresignedGetUrl(file.storageKey, 3600);

    return { downloadUrl };
  }
}
```

- [ ] **Step 2: 创建 `server/src/public/public.controller.ts`**

```typescript
import { Controller, Get, Post, Param, Req } from '@nestjs/common';
import { PublicService } from './public.service';
import { Request } from 'express';

@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get('files/:urlKey')
  async getFileMeta(@Param('urlKey') urlKey: string) {
    return this.publicService.getFileMeta(urlKey);
  }

  @Post('files/:urlKey/view')
  async recordView(@Param('urlKey') urlKey: string, @Req() req: Request) {
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
    return this.publicService.recordView(urlKey, ip);
  }

  @Get('files/:urlKey/download')
  async download(@Param('urlKey') urlKey: string, @Req() req: Request) {
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
    return this.publicService.getDownloadUrl(urlKey, ip);
  }
}
```

- [ ] **Step 3: 创建 `server/src/public/public.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';

@Module({
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
```

- [ ] **Step 4: 修改 `server/src/app.module.ts` 导入 PublicModule**

```typescript
import { PublicModule } from './public/public.module';

@Module({
  imports: [
    // ... 已有模块
    PublicModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 5: 提交**

```bash
git add server/
git commit -m "feat: add PublicModule for file preview meta, view/download tracking"
```

---

### Task 2: API 密钥管理 + ApiKeyAuthGuard

**Files:**

- Create: `server/src/common/guards/api-key.guard.ts`
- Create: `server/src/api-keys/api-keys.service.ts`
- Create: `server/src/api-keys/api-keys.controller.ts`
- Create: `server/src/api-keys/api-keys.module.ts`
- Modify: `server/src/app.module.ts`（导入 ApiKeysModule）

**Interfaces:**

- Consumes: `PrismaService`（Phase 2）
- Consumes: `FilesService`（Phase 3）
- Produces: `POST /api/keys` — 创建 API Key，返回明文（仅一次）
- Produces: `GET /api/keys` — 获取密钥列表
- Produces: `DELETE /api/keys/:id` — 删除密钥
- Produces: `ApiKeyAuthGuard` — 用于 ShareX 等工具通过 API Key 鉴权上传文件

- [ ] **Step 1: 创建 `server/src/common/guards/api-key.guard.ts`**

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash } from 'crypto';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string;

    if (!apiKey) {
      throw new UnauthorizedException('缺少 API Key');
    }

    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    const apiKeyRecord = await this.prisma.apiKey.findFirst({
      where: { keyHash },
      include: { user: true },
    });

    if (!apiKeyRecord) {
      throw new UnauthorizedException('无效的 API Key');
    }

    // 更新最后使用时间
    await this.prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsed: new Date() },
    });

    // 将用户信息附加到 request 对象
    (request as any).user = {
      id: apiKeyRecord.user.id,
      email: apiKeyRecord.user.email,
      role: apiKeyRecord.user.role,
      tier: apiKeyRecord.user.tier,
    };

    return true;
  }
}
```

- [ ] **Step 2: 创建 `server/src/api-keys/api-keys.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomUUID } from 'crypto';

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  async createApiKey(userId: string, name: string) {
    // 生成明文密钥
    const rawKey = `csp_${randomUUID().replace(/-/g, '')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        name,
        keyHash,
      },
    });

    return {
      id: apiKey.id,
      name: apiKey.name,
      key: rawKey, // 明文仅返回一次
      createdAt: apiKey.createdAt,
    };
  }

  async listApiKeys(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        lastUsed: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteApiKey(userId: string, keyId: string) {
    const apiKey = await this.prisma.apiKey.findFirst({
      where: { id: keyId, userId },
    });

    if (!apiKey) {
      throw new NotFoundException('API Key 不存在');
    }

    await this.prisma.apiKey.delete({
      where: { id: keyId },
    });

    return { message: 'API Key 已删除' };
  }
}
```

- [ ] **Step 3: 创建 `server/src/api-keys/api-keys.controller.ts`**

```typescript
import { Controller, Post, Get, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { IsNotEmpty, IsString } from 'class-validator';

class CreateApiKeyDto {
  @IsNotEmpty()
  @IsString()
  name: string;
}

@Controller('keys')
@UseGuards(JwtAuthGuard)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  async create(@CurrentUser('id') userId: string, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.createApiKey(userId, dto.name);
  }

  @Get()
  async list(@CurrentUser('id') userId: string) {
    return this.apiKeysService.listApiKeys(userId);
  }

  @Delete(':id')
  async delete(@CurrentUser('id') userId: string, @Param('id') keyId: string) {
    return this.apiKeysService.deleteApiKey(userId, keyId);
  }
}
```

- [ ] **Step 4: 创建 `server/src/api-keys/api-keys.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';

@Module({
  controllers: [ApiKeysController],
  providers: [ApiKeysService],
  exports: [ApiKeysService],
})
export class ApiKeysModule {}
```

- [ ] **Step 5: 在 FilesController 中添加支持 API Key 鉴权的上传路由**

修改 `server/src/files/files.controller.ts`，在已有的 presign 路由下方添加一条支持 ApiKey 的路由：

```typescript
import { ApiKeyGuard } from '../common/guards/api-key.guard';

// 在 FilesController 中添加：

@Post('presign/api-key')
@UseGuards(ApiKeyGuard)
presignUploadApiKey(
  @CurrentUser('id') userId: string,
  @Body() dto: PresignUploadDto,
) {
  return this.filesService.presignUpload(userId, dto);
}
```

注意：由于 `presignUploadApiKey` 在同一个 controller 中，需要在文件顶部确保 `ApiKeyGuard` 已导入。

- [ ] **Step 6: 修改 `server/src/app.module.ts` 导入 ApiKeysModule**

```typescript
import { ApiKeysModule } from './api-keys/api-keys.module';

@Module({
  imports: [
    // ... 已有模块
    ApiKeysModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: 提交**

```bash
git add server/
git commit -m "feat: add ApiKeysModule with CRUD and ApiKeyGuard for ShareX upload"
```

---

### Task 3: 管理员后台接口

**Files:**

- Create: `server/src/admin/admin.module.ts`
- Create: `server/src/admin/admin.service.ts`
- Create: `server/src/admin/admin.controller.ts`
- Modify: `server/src/app.module.ts`（导入 AdminModule）

**Interfaces:**

- Consumes: `PrismaService`（Phase 2）
- Consumes: `AdminRoleGuard` + `@Roles('admin')`（Phase 2）
- Produces: `GET /api/admin/users` — 用户列表（分页）
- Produces: `PATCH /api/admin/users/:id` — 修改用户等级/角色
- Produces: `DELETE /api/admin/users/:id` — 禁用用户（软删除）
- Produces: `GET /api/admin/stats` — 全局统计

- [ ] **Step 1: 创建 `server/src/admin/admin.service.ts`**

```typescript
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, Tier } from '@prisma/client';

const FREE_STORAGE_LIMIT = 500 * 1024 * 1024;
const VIP_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getUsers(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          nickname: true,
          avatarUrl: true,
          role: true,
          tier: true,
          createdAt: true,
          quota: {
            select: {
              storageLimit: true,
              storageUsed: true,
            },
          },
          _count: {
            select: {
              files: true,
            },
          },
        },
      }),
      this.prisma.user.count(),
    ]);

    return {
      items: users.map((u) => ({
        ...u,
        quota: u.quota
          ? {
              storageLimit: Number(u.quota.storageLimit),
              storageUsed: Number(u.quota.storageUsed),
            }
          : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateUser(userId: string, role?: Role, tier?: Tier) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const updateData: Record<string, any> = {};

    if (role !== undefined) {
      updateData.role = role;
    }

    if (tier !== undefined) {
      updateData.tier = tier;

      // 同步更新配额
      const newLimit = tier === Tier.vip ? VIP_STORAGE_LIMIT : FREE_STORAGE_LIMIT;
      await this.prisma.userQuota.upsert({
        where: { userId },
        create: {
          userId,
          storageLimit: newLimit,
          tier,
        },
        update: {
          storageLimit: newLimit,
          tier,
        },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return { message: '用户信息已更新' };
  }

  async disableUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (user.role === Role.admin) {
      throw new BadRequestException('不能禁用管理员账户');
    }

    // 删除用户的所有文件记录（S3 上的文件保留，仅删记录）
    await this.prisma.file.deleteMany({
      where: { userId },
    });

    // 删除用户配额
    await this.prisma.userQuota.deleteMany({
      where: { userId },
    });

    // 删除 API 密钥
    await this.prisma.apiKey.deleteMany({
      where: { userId },
    });

    // 删除用户
    await this.prisma.user.delete({
      where: { id: userId },
    });

    return { message: '用户已禁用' };
  }

  async getStats() {
    const [totalUsers, totalFiles, totalSizeResult, totalViewsResult, totalDownloadsResult] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.file.count({ where: { deletedAt: null } }),
        this.prisma.file.aggregate({
          where: { deletedAt: null },
          _sum: { fileSize: true },
        }),
        this.prisma.file.aggregate({
          where: { deletedAt: null },
          _sum: { viewCount: true },
        }),
        this.prisma.file.aggregate({
          where: { deletedAt: null },
          _sum: { downloadCount: true },
        }),
      ]);

    return {
      totalUsers,
      totalFiles,
      totalStorage: Number(totalSizeResult._sum.fileSize || 0),
      totalViews: totalViewsResult._sum.viewCount || 0,
      totalDownloads: totalDownloadsResult._sum.downloadCount || 0,
    };
  }
}
```

- [ ] **Step 2: 创建 `server/src/admin/admin.controller.ts`**

```typescript
import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../common/guards/admin-role.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { IsOptional, IsEnum } from 'class-validator';
import { Role, Tier } from '@prisma/client';

class UpdateUserDto {
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsEnum(Tier)
  tier?: Tier;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
@Roles('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  getUsers(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    return this.adminService.getUsers(page, limit);
  }

  @Patch('users/:id')
  updateUser(@Param('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(userId, dto.role, dto.tier);
  }

  @Delete('users/:id')
  disableUser(@Param('id') userId: string) {
    return this.adminService.disableUser(userId);
  }

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }
}
```

- [ ] **Step 3: 创建 `server/src/admin/admin.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
```

- [ ] **Step 4: 修改 `server/src/app.module.ts` 导入 AdminModule**

```typescript
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    // ... 已有模块
    AdminModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 5: 提交**

```bash
git add server/
git commit -m "feat: add AdminModule with user management and global stats"
```

---

## 验证清单

完成所有 Task 后，执行以下验证：

1. **启动服务：**

   ```bash
   cd server && npm run start:dev
   ```

2. **验证公共文件元数据（无需登录）：**

   ```bash
   curl http://localhost:3000/api/public/files/test.jpg
   ```

   预期：返回文件元数据 `{ id, originalName, urlKey, fileSize, mimeType, viewCount, downloadCount, createdAt, user: { nickname } }` 或 404

3. **验证记录浏览：**

   ```bash
   curl -X POST http://localhost:3000/api/public/files/test.jpg/view
   ```

   预期：返回 `{ message: "ok" }`

4. **验证下载 URL 生成：**

   ```bash
   curl http://localhost:3000/api/public/files/test.jpg/download
   ```

   预期：返回 `{ downloadUrl: "https://..." }`

5. **验证 API Key 创建（需登录）：**

   ```bash
   TOKEN=<access_token>
   curl -X POST http://localhost:3000/api/keys \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"ShareX"}'
   ```

   预期：返回 `{ id, name, key: "csp_...", createdAt }`（key 明文仅返回一次）

6. **验证通过 API Key 上传文件：**

   ```bash
   API_KEY=<从上一步获取的 key>
   curl -X POST http://localhost:3000/api/files/presign/api-key \
     -H "x-api-key: $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"filename":"sharex-test.png","contentType":"image/png","fileSize":51200}'
   ```

   预期：返回 `{ uploadUrl, storageKey }`

7. **验证管理员统计（需 admin token）：**

   ```bash
   ADMIN_TOKEN=<admin_access_token>
   curl http://localhost:3000/api/admin/stats \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

   预期：返回 `{ totalUsers, totalFiles, totalStorage, totalViews, totalDownloads }`

8. **验证管理员用户列表：**

   ```bash
   curl http://localhost:3000/api/admin/users?page=1&limit=10 \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```

   预期：返回 `{ items: [...], total, page, limit, totalPages }`

9. **验证管理员修改用户等级：**
   ```bash
   curl -X PATCH http://localhost:3000/api/admin/users/<userId> \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"tier":"vip"}'
   ```
   预期：返回 `{ message: "用户信息已更新" }`
