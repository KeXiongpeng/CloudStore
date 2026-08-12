# Phase 1: 项目基础设施搭建 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建前后端分离项目基础设施，Docker Compose 一键启动，前后端可通信，数据库 Schema 就绪。

**Architecture:** 三个子项目（client/Next.js, server/NestJS, nginx）通过 Docker Compose 编排。Nginx 做反向代理，/api/* 转发到 NestJS，其他请求转发到 Next.js。PostgreSQL 和 Redis 作为基础设施服务。NestJS 使用 Prisma + PostgreSQL。

**Tech Stack:** Next.js 14 (App Router), NestJS 10, TypeScript, TailwindCSS, PostgreSQL 16, Redis 7, Nginx, Docker Compose, Prisma ORM

## Global Constraints

- 前端: React + Next.js (App Router) + TailwindCSS + TypeScript
- 后端: NestJS + TypeScript + Prisma ORM
- 数据库: PostgreSQL 16
- 缓存: Redis 7
- 对象存储: 七牛云 S3 兼容接口
- 部署: Docker Compose + Nginx
- 所有环境变量通过 .env 管理

---

## File Structure Overview

```
project-root/
├── package.json              # workspace 占位
├── docker-compose.yml       # 生产编排（5个服务）
├── docker-compose.dev.yml   # 开发覆盖（挂载本地卷）
├── .env.example             # 环境变量模板
├── .gitignore               # Git 忽略规则
├── .npmrc                   # npm 配置
├── nginx/
│   └── nginx.conf           # 反向代理配置
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── nest-cli.json
│   ├── Dockerfile
│   ├── prisma/
│   │   ├── schema.prisma    # 数据库 Schema
│   │   └── seed.ts          # 种子数据
│   └── src/
│       ├── main.ts          # 启动入口
│       ├── app.module.ts    # 根模块
│       └── common/
│           └── config/
│               └── configuration.ts  # 环境变量验证
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── Dockerfile
    └── src/
        ├── app/
        │   ├── layout.tsx   # 根布局
        │   ├── page.tsx     # 首页占位
        │   └── globals.css  # TailwindCSS 入口
        └── lib/
            └── api.ts       # API 客户端
```

---

### Task 1: 根目录配置 + Docker Compose

**Files:**
- Create: `package.json`
- Create: `docker-compose.yml`
- Create: `docker-compose.dev.yml`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `.npmrc`

**Interfaces:**
- Produces: Docker Compose 网络和服务定义，供 Task 2/3/4/5 的容器使用
- Produces: `.env.example` 定义所有环境变量名称，供 Task 2/3 参考验证逻辑
- Produces: `.npmrc` 统一 npm 配置，供 client/ 和 server/ 继承

- [ ] **Step 1: 创建根目录 `package.json`**

```json
{
  "name": "cloud-storage-platform",
  "version": "0.1.0",
  "private": true,
  "description": "云存储文件分享平台",
  "scripts": {
    "dev": "docker compose -f docker-compose.yml -f docker-compose.dev.yml up",
    "dev:build": "docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build",
    "start": "docker compose up -d",
    "stop": "docker compose down",
    "logs": "docker compose logs -f"
  }
}
```

- [ ] **Step 2: 创建 `docker-compose.yml`**

```yaml
services:
  nginx:
    image: nginx:1.25-alpine
    container_name: csp-nginx
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      nextjs:
        condition: service_started
      nestjs:
        condition: service_started
    networks:
      - csp-network
    restart: unless-stopped

  nextjs:
    build:
      context: ./client
      dockerfile: Dockerfile
    container_name: csp-nextjs
    environment:
      - NEXT_PUBLIC_API_URL=http://nestjs:3000
    networks:
      - csp-network
    restart: unless-stopped

  nestjs:
    build:
      context: ./server
      dockerfile: Dockerfile
    container_name: csp-nestjs
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - QINIU_ACCESS_KEY=${QINIU_ACCESS_KEY}
      - QINIU_SECRET_KEY=${QINIU_SECRET_KEY}
      - QINIU_BUCKET=${QINIU_BUCKET}
      - QINIU_ENDPOINT=${QINIU_ENDPOINT}
      - CORS_ORIGIN=${CORS_ORIGIN}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - csp-network
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    container_name: csp-postgres
    environment:
      - POSTGRES_USER=${POSTGRES_USER}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=${POSTGRES_DB}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - csp-network
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: csp-redis
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - csp-network
    restart: unless-stopped

volumes:
  postgres-data:
  redis-data:

networks:
  csp-network:
    driver: bridge
```

- [ ] **Step 3: 创建 `docker-compose.dev.yml`（开发环境覆盖）**

```yaml
services:
  nextjs:
    build:
      context: ./client
      dockerfile: Dockerfile
    volumes:
      - ./client/src:/app/src
    environment:
      - NEXT_PUBLIC_API_URL=http://nestjs:3000
      - NODE_ENV=development
    command: npm run dev

  nestjs:
    build:
      context: ./server
      dockerfile: Dockerfile
    volumes:
      - ./server/src:/app/src
      - ./server/prisma:/app/prisma
    environment:
      - NODE_ENV=development
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - QINIU_ACCESS_KEY=${QINIU_ACCESS_KEY}
      - QINIU_SECRET_KEY=${QINIU_SECRET_KEY}
      - QINIU_BUCKET=${QINIU_BUCKET}
      - QINIU_ENDPOINT=${QINIU_ENDPOINT}
      - CORS_ORIGIN=http://localhost:3001
    command: npm run start:dev

  postgres:
    ports:
      - "5432:5432"

  redis:
    ports:
      - "6379:6379"
```

- [ ] **Step 4: 创建 `.env.example`**

```env
# PostgreSQL
POSTGRES_USER=csp_user
POSTGRES_PASSWORD=csp_password_2024
POSTGRES_DB=cloud_storage
DATABASE_URL=postgresql://csp_user:csp_password_2024@postgres:5432/cloud_storage?schema=public

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# JWT
JWT_SECRET=your-jwt-secret-key-change-in-production
JWT_REFRESH_SECRET=your-jwt-refresh-secret-key-change-in-production

# 七牛云 S3
QINIU_ACCESS_KEY=your-qiniu-access-key
QINIU_SECRET_KEY=your-qiniu-secret-key
QINIU_BUCKET=your-bucket-name
QINIU_ENDPOINT=https://s3.cn-east-1.qiniu.com

# CORS
CORS_ORIGIN=https://your-domain.com

# Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=admin123456
```

- [ ] **Step 5: 创建 `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnp
.pnp.js

# Build output
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# Docker
docker-compose.override.yml

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Prisma
server/prisma/migrations/

# SSL
nginx/ssl/

# Uploads
uploads/

# Coverage
coverage/
```

- [ ] **Step 6: 创建 `.npmrc`**

```ini
engine-strict=true
save-exact=true
```

- [ ] **Step 7: 提交**

```bash
git add package.json docker-compose.yml docker-compose.dev.yml .env.example .gitignore .npmrc
git commit -m "chore: add root config, docker-compose, and env template"
```

---

### Task 2: NestJS 项目脚手架 + 核心模块

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/nest-cli.json`
- Create: `server/tsconfig.build.json`
- Create: `server/Dockerfile`
- Create: `server/src/main.ts`
- Create: `server/src/app.module.ts`
- Create: `server/src/common/config/configuration.ts`

**Interfaces:**
- Consumes: `.env.example` 中的环境变量名（Task 1）
- Produces: `server/Dockerfile` 供 `docker-compose.yml` 构建 NestJS 镜像（Task 1）
- Produces: NestJS 应用监听 3000 端口，全局前缀 `/api`，供 Nginx 代理（Task 4）

- [ ] **Step 1: 创建 `server/package.json`**

```json
{
  "name": "cloud-storage-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:migrate:prod": "prisma migrate deploy",
    "prisma:seed": "ts-node prisma/seed.ts",
    "prisma:studio": "prisma studio"
  },
  "dependencies": {
    "@nestjs/common": "^10.3.0",
    "@nestjs/config": "^3.1.1",
    "@nestjs/core": "^10.3.0",
    "@nestjs/platform-express": "^10.3.0",
    "@nestjs/swagger": "^7.2.0",
    "@prisma/client": "^5.10.0",
    "class-transformer": "^0.5.1",
    "class-validator": "^0.14.1",
    "joi": "^17.11.0",
    "reflect-metadata": "^0.2.1",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.3.0",
    "@nestjs/schematics": "^10.1.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.11.0",
    "prisma": "^5.10.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: 创建 `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 创建 `server/tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "declaration": true
  },
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

- [ ] **Step 4: 创建 `server/nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

- [ ] **Step 5: 创建 `server/src/common/config/configuration.ts`**

```typescript
import * as Joi from 'joi';

export const configuration = () => ({
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTokenTtl: 15 * 60,       // 15 minutes
    refreshTokenTtl: 7 * 24 * 60 * 60, // 7 days
  },
  qiniu: {
    accessKey: process.env.QINIU_ACCESS_KEY,
    secretKey: process.env.QINIU_SECRET_KEY,
    bucket: process.env.QINIU_BUCKET,
    endpoint: process.env.QINIU_ENDPOINT,
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  },
});

export const configValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().default(6379),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  QINIU_ACCESS_KEY: Joi.string().required(),
  QINIU_SECRET_KEY: Joi.string().required(),
  QINIU_BUCKET: Joi.string().required(),
  QINIU_ENDPOINT: Joi.string().required(),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
});
```

- [ ] **Step 6: 创建 `server/src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration, configValidationSchema } from './common/config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
    }),
  ],
})
export class AppModule {}
```

- [ ] **Step 7: 创建 `server/src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const corsOrigin = configService.get<string>('cors.origin', 'http://localhost:3001');

  app.setGlobalPrefix('api');

  app.enableCors({
    origin: corsOrigin === '*' ? true : corsOrigin.split(','),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = 3000;
  await app.listen(port);
  console.log(`NestJS application running on port ${port}`);
}

bootstrap();
```

- [ ] **Step 8: 创建 `server/Dockerfile`**

```dockerfile
FROM node:20-alpine AS base

RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

USER nestjs

EXPOSE 3000

CMD ["npm", "run", "start:prod"]
```

- [ ] **Step 9: 提交**

```bash
git add server/
git commit -m "feat: scaffold NestJS project with config module and Dockerfile"
```

---

### Task 3: Prisma Schema + 数据库迁移种子

**Files:**
- Create: `server/prisma/schema.prisma`
- Create: `server/prisma/seed.ts`

**Interfaces:**
- Consumes: `.env.example` 中 `DATABASE_URL` 变量名（Task 1）
- Consumes: `AppModule`（Task 2），后续 Phase 需在 AppModule 中注册 `PrismaModule`
- Produces: 完整数据库 Schema（6 张表 + 4 个枚举），数据库迁移后可被 NestJS 通过 `@prisma/client` 查询

- [ ] **Step 1: 创建 `server/prisma/schema.prisma`**

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum Role {
  user
  admin
}

enum Tier {
  free
  vip
}

enum OAuthProvider {
  github
  google
}

enum AccessAction {
  view
  download
}

model User {
  id            String         @id @default(uuid())
  email         String         @unique
  passwordHash  String?        @map("password_hash")
  nickname      String?
  avatarUrl     String?        @map("avatar_url")
  role          Role           @default(user)
  tier          Tier           @default(free)
  createdAt     DateTime       @default(now()) @map("created_at")
  updatedAt     DateTime       @updatedAt @map("updated_at")

  oauthAccounts OAuthAccount[]
  files         File[]
  quota         UserQuota?
  apiKeys       ApiKey[]

  @@map("users")
}

model OAuthAccount {
  id         String        @id @default(uuid())
  userId     String        @map("user_id")
  provider   OAuthProvider
  providerId String        @map("provider_id")
  createdAt  DateTime      @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerId])
  @@map("oauth_accounts")
}

model File {
  id            String       @id @default(uuid())
  userId        String       @map("user_id")
  originalName  String       @map("original_name")
  storageKey    String       @unique @map("storage_key")
  urlKey        String       @unique @map("url_key")
  fileSize      BigInt       @map("file_size")
  mimeType      String       @map("mime_type")
  isPrivate     Boolean      @default(false) @map("is_private")
  viewCount     Int          @default(0) @map("view_count")
  downloadCount Int          @default(0) @map("download_count")
  uploadIp      String?      @map("upload_ip")
  createdAt     DateTime     @default(now()) @map("created_at")
  deletedAt     DateTime?    @map("deleted_at")

  user       User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessLogs AccessLog[]

  @@map("files")
}

model UserQuota {
  id           String   @id @default(uuid())
  userId       String   @unique @map("user_id")
  storageLimit BigInt   @map("storage_limit")
  storageUsed  BigInt   @default(0) @map("storage_used")
  tier         Tier     @default(free)
  updatedAt    DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("user_quotas")
}

model ApiKey {
  id       String    @id @default(uuid())
  userId   String    @map("user_id")
  name     String
  keyHash  String    @map("key_hash")
  lastUsed DateTime? @map("last_used")
  createdAt DateTime @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("api_keys")
}

model AccessLog {
  id         String       @id @default(uuid())
  fileId     String       @map("file_id")
  ip         String
  action     AccessAction
  accessedAt DateTime     @default(now()) @map("accessed_at")

  file File @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@map("access_logs")
}
```

- [ ] **Step 2: 创建 `server/prisma/seed.ts`**

```typescript
import { PrismaClient, Role, Tier } from '@prisma/client';

const prisma = new PrismaClient();

const FREE_STORAGE_LIMIT = 500 * 1024 * 1024; // 500MB
const VIP_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10GB

async function main() {
  console.log('Seeding database...');

  // 创建 admin 用户
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log('Admin user already exists, skipping...');
  } else {
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: adminPassword, // Phase 2 中替换为 bcrypt 哈希
        nickname: 'Admin',
        role: Role.admin,
        tier: Tier.vip,
      },
    });

    await prisma.userQuota.create({
      data: {
        userId: admin.id,
        storageLimit: VIP_STORAGE_LIMIT,
        tier: Tier.vip,
      },
    });

    console.log(`Admin user created: ${admin.email}`);
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 3: 提交**

```bash
git add server/prisma/
git commit -m "feat: add Prisma schema with 6 tables and seed script"
```

---

### Task 4: Nginx 反向代理配置

**Files:**
- Create: `nginx/nginx.conf`

**Interfaces:**
- Consumes: `docker-compose.yml` 中 nginx 容器挂载此配置（Task 1）
- Consumes: NestJS 端口 3000（Task 2）、Next.js 端口 3001（Task 5）
- Produces: 外部通过 80/443 端口访问，`/api/*` 路由到 NestJS，`/*` 路由到 Next.js

- [ ] **Step 1: 创建 `nginx/nginx.conf`**

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    tcp_nopush      on;
    tcp_nodelay     on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/atom+xml image/svg+xml;

    # 上传文件大小限制
    client_max_body_size 100m;

    upstream nestjs_backend {
        server nestjs:3000;
    }

    upstream nextjs_frontend {
        server nextjs:3001;
    }

    # HTTP → HTTPS 重定向
    server {
        listen 80;
        server_name _;

        # 开发环境直接代理，不重定向
        location / {
            proxy_pass http://nextjs_frontend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        location /api/ {
            proxy_pass http://nestjs_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 300s;
            proxy_send_timeout 300s;
        }
    }

    # HTTPS（需要配置 SSL 证书后启用）
    # server {
    #     listen 443 ssl http2;
    #     server_name your-domain.com;
    #
    #     ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    #     ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    #     ssl_protocols       TLSv1.2 TLSv1.3;
    #     ssl_ciphers         HIGH:!aNULL:!MD5;
    #
    #     location /api/ {
    #         proxy_pass http://nestjs_backend;
    #         proxy_http_version 1.1;
    #         proxy_set_header Host $host;
    #         proxy_set_header X-Real-IP $remote_addr;
    #         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #         proxy_set_header X-Forwarded-Proto $scheme;
    #         proxy_read_timeout 300s;
    #         proxy_send_timeout 300s;
    #     }
    #
    #     location / {
    #         proxy_pass http://nextjs_frontend;
    #         proxy_http_version 1.1;
    #         proxy_set_header Upgrade $http_upgrade;
    #         proxy_set_header Connection 'upgrade';
    #         proxy_set_header Host $host;
    #         proxy_set_header X-Real-IP $remote_addr;
    #         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #         proxy_set_header X-Forwarded-Proto $scheme;
    #         proxy_cache_bypass $http_upgrade;
    #     }
    # }
}
```

- [ ] **Step 2: 提交**

```bash
git add nginx/
git commit -m "feat: add Nginx reverse proxy config with gzip and upload limit"
```

---

### Task 5: Next.js 项目脚手架 + API 客户端

**Files:**
- Create: `client/package.json`
- Create: `client/tsconfig.json`
- Create: `client/next.config.ts`
- Create: `client/tailwind.config.ts`
- Create: `client/postcss.config.js`
- Create: `client/Dockerfile`
- Create: `client/src/app/layout.tsx`
- Create: `client/src/app/page.tsx`
- Create: `client/src/app/globals.css`
- Create: `client/src/lib/api.ts`

**Interfaces:**
- Consumes: `.env.example` 中的环境变量约定（Task 1）
- Produces: `client/Dockerfile` 供 `docker-compose.yml` 构建前端镜像（Task 1）
- Produces: Next.js 应用监听 3001 端口，供 Nginx 代理（Task 4）
- Produces: `api.ts` 导出 `api` 实例，后续 Phase 前端页面通过此客户端调用后端

- [ ] **Step 1: 创建 `client/package.json`**

```json
{
  "name": "cloud-storage-client",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "lint": "next lint"
  },
  "dependencies": {
    "axios": "^1.6.7",
    "next": "^14.1.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.48",
    "@types/react-dom": "^18.2.18",
    "autoprefixer": "^10.4.17",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3"
  }
}
```

- [ ] **Step 2: 创建 `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: 创建 `client/next.config.ts`**

```typescript
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 4: 创建 `client/tailwind.config.ts`**

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 5: 创建 `client/postcss.config.js`**

```javascript
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 6: 创建 `client/src/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --foreground: #171717;
  --background: #ffffff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --foreground: #ededed;
    --background: #0a0a0a;
  }
}

body {
  color: var(--foreground);
  background: var(--background);
  font-family: Arial, Helvetica, sans-serif;
}
```

- [ ] **Step 7: 创建 `client/src/app/layout.tsx`**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '云存储文件分享平台',
  description: '上传文件，获取网络地址，他人打开链接即可在线预览和下载',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 8: 创建 `client/src/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold mb-4">云存储文件分享平台</h1>
      <p className="text-lg text-gray-600 dark:text-gray-400 text-center max-w-xl">
        上传文件，获取网络地址，他人打开链接即可在线预览和下载。
      </p>
    </main>
  );
}
```

- [ ] **Step 9: 创建 `client/src/lib/api.ts`**

```typescript
import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：添加 Authorization header
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// 响应拦截器：401 时跳转登录
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
```

- [ ] **Step 10: 创建 `client/Dockerfile`**

```dockerfile
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3001

ENV PORT=3001
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

- [ ] **Step 11: 提交**

```bash
git add client/
git commit -m "feat: scaffold Next.js project with TailwindCSS, API client, and Dockerfile"
```

---

## 验证清单

完成所有 Task 后，执行以下验证：

1. **复制环境变量模板：**
   ```bash
   cp .env.example .env
   ```

2. **构建并启动所有服务：**
   ```bash
   docker compose up --build
   ```

3. **验证 PostgreSQL 连接和表创建：**
   ```bash
   docker exec -it csp-nestjs npx prisma migrate deploy
   docker exec -it csp-nestjs npx prisma db seed
   ```

4. **验证 NestJS API 响应：**
   ```bash
   curl http://localhost/api  # 应返回 404（NestJS 默认无根路由）
   ```

5. **验证 Next.js 前端：**
   - 浏览器打开 `http://localhost`，应看到首页"云存储文件分享平台"

6. **验证前后端通信：**
   ```bash
   curl http://localhost/api  # 通过 Nginx 代理到 NestJS
   curl http://localhost    # 通过 Nginx 代理到 Next.js
   ```
