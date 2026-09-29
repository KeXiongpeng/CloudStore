# CloudStore · 云存储与知识库问答平台

CloudStore 是一个 workspace 化的云存储与 AI 知识库平台，支持大文件上传、在线预览、公开分享、权限协作，以及基于 pgvector 的文档语义检索和流式 RAG 问答。

## 核心功能

- 邮箱注册 / 登录，JWT Access Token + Refresh Token
- GitHub / Google OAuth 登录，预留微信登录能力
- Workspace 隔离、成员邀请、RBAC 权限与审计日志
- 小文件预签名直传，大文件分片上传，支持秒传、重试与队列进度
- 图片、视频、音频、PDF、文本等类型在线预览
- 公开分享链接、随机 URL、二维码分享
- Markdown / TXT / PDF 解析、切块、Embedding、pgvector 入库
- Workspace 级知识库检索、服务端多轮上下文、检索工具化、guided fallback、action cards、SSE 流式回答与引用溯源
- 20 题 RAG 评估集与可重复执行 evaluation runner
- 用户存储配额、文件访问统计和管理后台

## 技术栈

| 层级     | 技术                                                              |
| -------- | ----------------------------------------------------------------- |
| 前端     | Next.js 14 App Router、React 18、TypeScript、Tailwind CSS         |
| 后端     | NestJS 10、Passport / JWT、class-validator                        |
| 数据层   | PostgreSQL 16 + pgvector、Prisma ORM、Redis 7                     |
| 异步任务 | BullMQ、独立 server-worker                                        |
| 对象存储 | MinIO / 七牛云 S3 兼容存储、AWS SDK v3                            |
| AI 能力  | SiliconFlow Embeddings `BAAI/bge-m3`、DeepSeek Chat、LangGraph.js |
| 基础设施 | Docker Compose、Nginx / shared Nginx Proxy、standalone Next.js    |

## 架构总览

```mermaid
flowchart LR
  U[用户浏览器] --> P[Nginx / Shared Nginx Proxy]
  P --> F[Next.js 14 前端]
  P --> A[NestJS API]

  F -->|同源 /api rewrite| A
  F -->|预签名 URL 直传| S[(MinIO / S3 兼容存储)]

  A --> D[(PostgreSQL 16 + pgvector)]
  A --> R[(Redis / BullMQ)]
  A --> S

  A -->|document-index job| W[server-worker]
  W --> S
  W --> E[Embedding API]
  W --> D

  U -->|提问| F
  A -->|retrieve| D
  A -->|judge / rewrite / generate| L[DeepSeek Chat]
  A -->|SSE sources / delta / done| U
```

详细说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 知识库链路

1. 用户在 workspace 上传 `.md` / `.txt` / `.pdf`。
2. 上传完成创建 `document-index` BullMQ 任务。
3. worker 下载对象存储文件，抽取文本并切块。
4. 批量调用 Embedding API 生成向量。
5. 事务重建 `document_chunks`，等待文档状态变为 `indexed`。
6. 用户提问时，后端保存服务端 ChatSession/ChatMessage；RAG 图先用 history 改写 standalone query，再调用受 workspaceId 隔离的 `search_knowledge_base` 工具检索 pgvector。
7. 无证据时按“空知识库 / 无结果 / 相似但不完整”返回引导文案和后端推导 action cards。
8. LangGraph 执行 `retrieve → judge → rewrite / generate / fallback`。
9. 前端接收 `sources → delta... → done` SSE 事件，并展示 `[1][2][3]` 引用。

评估集和执行方式见 [server/evaluation/README.md](server/evaluation/README.md)。

## 本地开发

### 1. 环境要求

- Node.js 20+
- Docker / Docker Compose
- MinIO 或 S3 兼容对象存储
- SiliconFlow Embeddings API Key
- DeepSeek Chat API Key

### 2. 配置环境变量

```bash
cp .env.example .env
```

至少配置数据库、Redis、对象存储、JWT 和 AI API Key。不要提交真实 `.env`。

本地宿主机运行后端时，创建 `server/.env`，并把容器主机名改为本机映射端口：

```env
DATABASE_URL=postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public
REDIS_HOST=localhost
REDIS_PORT=6380
STORAGE_DRIVER=minio
MINIO_ENDPOINT=http://localhost:9000
```

### 3. 启动依赖

```bash
docker compose -f docker-compose.dev.yml up -d
```

默认映射：

| 服务                     | 宿主机端口 |
| ------------------------ | ---------- |
| PostgreSQL 16 + pgvector | `5433`     |
| Redis                    | `6380`     |
| MinIO S3                 | `9000`     |
| MinIO Console            | `9001`     |

### 4. 启动后端与 worker

```bash
cd server
npm install
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

另一个终端启动异步 worker：

```bash
cd server
npm run start:worker
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

## 测试与评估

```bash
# 后端
cd server
npm run test
npm run typecheck
npm run build

# 前端
cd client
npm run test
npx tsc --noEmit
npm run build

# RAG 评估
cd server
npm run rag:evaluate -- --label rag-baseline --workspace-a <A_ID> --workspace-b <B_ID>
```

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

生产站点当前为 `https://cloudstore.kxpwty.cn`，回调地址示例：

```text
https://cloudstore.kxpwty.cn/api/auth/github/callback
https://cloudstore.kxpwty.cn/api/auth/google/callback
https://cloudstore.kxpwty.cn/api/auth/wechat/callback
```

第三方平台后台必须填写完全一致的回调地址。

## 接口文档

完整接口说明见 [docs/API.md](docs/API.md)。

常用模块：

- 认证：`/api/auth/*`
- 用户：`/api/users/*`
- 文件：`/api/files/*`
- Workspace：`/api/workspaces/*`
- 知识库：`/api/documents/*`
- RAG 问答：`/api/workspaces/:workspaceId/chat`
- 知识库统计：`/api/workspaces/:workspaceId/knowledge/stats`
- 公开访问：`/api/public/*`
- 管理后台：`/api/admin/*`

## 部署

项目提供三套 Compose 文件：

- `docker-compose.dev.yml`：本地 PostgreSQL + pgvector、Redis、MinIO、worker 依赖
- `docker-compose.yml`：单机完整部署，包含 Nginx、前后端、PostgreSQL、Redis
- `docker-compose.prod.yml`：使用预构建镜像，包含 API、worker、前端和 pgvector，接入外部 Nginx Proxy

详细流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 项目结构

```text
client/                 Next.js 前端
server/                 NestJS API、worker、Prisma、领域模块
server/src/documents/   上传索引、解析、切块、pgvector 检索
server/src/chat/        服务端会话、LangGraph RAG、检索工具、guided fallback、SSE/action
server/src/evaluation/  20 题评估集、answer judge、指标与报告
docker/                 PostgreSQL / pgvector 构建辅助
docs/                   架构、数据库、接口、部署文档
```

## 安全说明

- 不要把真实 Access Key、Secret Key、JWT Secret、AI API Key 提交到 Git。
- 生产环境必须替换所有示例密码和演示账号。
- OAuth `state` 使用 HttpOnly Cookie 校验，防止 CSRF。
- 对象存储访问使用预签名 URL，不直接暴露长期凭证。
- RAG 检索必须带 `workspaceId`，空 workspace 会拒绝检索。
- 上游 AI 错误会转为用户可读信息，日志不输出 API Key 或完整上游响应。
