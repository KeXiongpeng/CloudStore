# CloudShare · 云存储文件分享平台

CloudShare 是一款云存储与文件分享产品，提供安全上传、大文件传输、在线预览、公开分享链接、二维码、访问统计、用户配额和管理后台。

## 核心功能

- 邮箱注册 / 登录，JWT Access Token + Refresh Token
- GitHub / Google OAuth 登录，预留微信登录能力
- 5MB 以内文件预签名直传，更大文件分片上传
- 公开分享链接、随机 URL、二维码分享
- 图片、视频、音频、PDF、文本等类型在线预览
- 文件浏览量、下载量与访问日志统计
- 用户存储配额：免费 500MB，VIP 10GB
- 管理后台：用户列表、角色 / 套餐调整、平台统计
- Docker Compose 编排前端、后端、PostgreSQL、Redis 和 Nginx

## 技术栈

| 层级     | 技术                                                      |
| -------- | --------------------------------------------------------- |
| 前端     | Next.js 14 App Router、React 18、TypeScript、Tailwind CSS |
| 后端     | NestJS 10、Passport / JWT、class-validator                |
| 数据层   | PostgreSQL 16、Prisma ORM、Redis 7                        |
| 对象存储 | 七牛云 S3 兼容存储、AWS SDK v3                            |
| 基础设施 | Docker Compose、Nginx、standalone Next.js                 |

## 架构总览

```mermaid
flowchart LR
  U[用户浏览器] --> N[Nginx / 反向代理]
  N --> F[Next.js 前端]
  N --> B[NestJS API]
  F -->|同源 /api 代理| B
  B --> P[(PostgreSQL)]
  B --> R[(Redis)]
  B --> S[S3 兼容对象存储]
  F -->|预签名 URL 直传| S
```

详细说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 本地开发

### 1. 环境要求

- Node.js 20+
- Docker / Docker Compose
- 一个 S3 兼容对象存储 Bucket，例如七牛云

### 2. 配置环境变量

```bash
cp .env.example .env
```

本地宿主机运行后端时，创建 `server/.env`，并把数据库地址中的容器主机名改为本机映射端口：

```env
DATABASE_URL=postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public
REDIS_HOST=localhost
REDIS_PORT=6380
```

### 3. 启动 PostgreSQL 和 Redis

```bash
docker compose -f docker-compose.dev.yml up -d
```

### 4. 启动后端

```bash
cd server
npm install
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

后端地址：<http://localhost:3000>

### 5. 启动前端

```bash
cd client
npm install
npm run dev
```

前端地址：<http://localhost:3001>

前端通过 `next.config.mjs` 将 `/api/:path*` 代理到后端，默认目标为 `http://localhost:3000`。

## 测试账号

以下账号仅用于本地开发和演示环境，生产环境必须通过环境变量修改：

| 角色         | 邮箱                | 密码          |
| ------------ | ------------------- | ------------- |
| 管理员       | `admin@example.com` | `admin123456` |
| 普通演示用户 | `demo@example.com`  | `demo123456`  |

管理员可访问 `/admin`。

## OAuth 登录配置

前端只显示后端已配置的第三方登录方式。可通过以下接口检查当前配置：

```http
GET /api/auth/providers
```

### 本地回调地址

| Provider | Authorization URL                       | Callback URL                                     |
| -------- | --------------------------------------- | ------------------------------------------------ |
| GitHub   | `http://localhost:3001/api/auth/github` | `http://localhost:3001/api/auth/github/callback` |
| Google   | `http://localhost:3001/api/auth/google` | `http://localhost:3001/api/auth/google/callback` |
| WeChat   | `http://localhost:3001/api/auth/wechat` | `http://localhost:3001/api/auth/wechat/callback` |

### 生产回调地址

站点域名配置为 `https://kxpwty.cn`：

```text
https://kxpwty.cn/api/auth/github/callback
https://kxpwty.cn/api/auth/google/callback
https://kxpwty.cn/api/auth/wechat/callback
```

GitHub、Google、微信开放平台后台必须填写完全一致的回调地址。

## 接口文档

完整接口说明见 [docs/API.md](docs/API.md)。

常用模块：

- 认证：`/api/auth/*`
- 用户：`/api/users/*`
- 文件：`/api/files/*`
- 公开访问：`/api/public/*`
- 管理后台：`/api/admin/*`

## 部署

项目提供两套 Compose 文件：

- `docker-compose.yml`：包含 Nginx、前后端、PostgreSQL、Redis 的完整本地 / 单机部署
- `docker-compose.prod.yml`：使用预构建镜像并接入外部 Nginx Proxy 的生产部署

详细流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 项目结构

```text
client/       Next.js 前端
server/       NestJS API、Prisma、领域模块
nginx/        Nginx 配置
docs/         架构、数据库、接口、部署文档
```

## 安全说明

- 不要把真实 Access Key、Secret Key、JWT Secret 提交到 Git。
- 生产环境必须替换所有示例密码。
- OAuth `state` 使用 HttpOnly Cookie 校验，防止 CSRF。
- 对象存储访问使用预签名 URL，不直接暴露长期凭证。

## Phase 3 Upload Pipeline

Local storage uses MinIO:

- API console: <http://localhost:9001>
- S3 endpoint: <http://localhost:9000>
- Default credentials: `minioadmin` / `minioadmin`
- Start dependencies: `docker compose -f docker-compose.dev.yml up -d`

Upload features: direct upload, 8 MiB multipart, resume, SHA-256 instant upload, reference-counted deduplication, retry/backoff, quota reservation, session expiry, and BullMQ thumbnails. Backend tests: `cd server && npm test`. Frontend tests: `cd client && npm test`.
