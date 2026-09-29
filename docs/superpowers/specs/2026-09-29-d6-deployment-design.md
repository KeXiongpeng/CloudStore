# D6 部署上线设计

## 背景与目标

D1-D5 已完成云存储、workspace 上传索引、pgvector 知识库、LangGraph RAG、SSE 流式回答、兜底隔离和 20 题评估。发布 commit 为 `926ab56 feat(rag): add pgvector knowledge base with SSE chat and evaluation`。

D6 目标是把这套系统安全地部署到 `https://cloudstore.kxpwty.cn`，并保证：

- 生产镜像可追溯到 Git commit；
- PostgreSQL 数据可备份、可恢复；
- 数据库迁移可在受控窗口执行；
- API 与 document-index worker 同时上线；
- RAG 环境变量和模型配额正确；
- 上传、indexed、RAG SSE、引用、兜底、workspace 隔离可验证；
- 出现问题时可回滚应用镜像。

## 当前生产拓扑

```text
浏览器
→ shared Nginx Proxy
→ Next.js standalone
→ /api rewrite
→ NestJS API

NestJS API
→ PostgreSQL 16 + pgvector
→ Redis / BullMQ
→ 七牛云 S3 或 MinIO
→ SiliconFlow Embeddings
→ DeepSeek Chat

server-worker
→ Redis document-index / thumbnail jobs
→ Object Storage
→ SiliconFlow Embeddings
→ PostgreSQL + pgvector
```

生产域名使用 `https://cloudstore.kxpwty.cn`。浏览器只访问同源 `/api/*`，由 Next.js rewrite 转发到容器内 `http://nestjs:3000`。

## 发布物

| 组件        | 当前基线                         | D6 目标                                                 |
| ----------- | -------------------------------- | ------------------------------------------------------- |
| server 镜像 | `v9`                             | `v10` 或更高                                            |
| client 镜像 | `v6`                             | `v7` 或更高                                             |
| PostgreSQL  | PostgreSQL 16                    | PostgreSQL 16 + pgvector                                |
| worker      | 已存在但需确认新 index processor | API 同镜像，`node dist/worker.js`                       |
| 数据库迁移  | 已有 workspace/upload migration  | 新增 pgvector、documents/chunks、unified document index |

## 本地生产演练设计

本地生产演练不是 `npm run start:dev`，而是在本机使用生产 Dockerfile 和生产形态容器运行，但不绑定生产域名、不使用生产数据库。

### 目标

```text
源码 → docker build server/client
→ prod-like compose
→ PostgreSQL + pgvector / Redis / MinIO
→ NestJS API + server-worker + Next.js standalone
→ migrate deploy
→ 冒烟测试
```

### 端口约定

为避免影响现有开发服务：

| 服务             | 本地端口                   |
| ---------------- | -------------------------- |
| Next.js frontend | `3101`                     |
| NestJS API       | 可选 `3200`，主要用于 curl |
| PostgreSQL       | 不暴露或 `35432`           |
| Redis            | 不暴露或 `36379`           |
| MinIO            | `39000` / `39001`          |

容器之间仍使用内部服务名：

```text
http://nestjs:3000
postgres:5432
redis:6379
minio:9000
```

### 差异控制

本地生产演练必须满足：

- 使用 `server/Dockerfile` 和 `client/Dockerfile`；
- 使用 production build；
- 使用独立 compose project name 和独立 volume；
- 使用测试密钥或额度可控的真实 API Key；
- 不挂载 `cloudstore.kxpwty.cn`；
- 不连接生产 PostgreSQL；
- 不复用 dev volume；
- 不执行生产 `pg_dump`。

允许与真实生产的差异：

- 域名是 localhost；
- TLS 由浏览器 HTTP 代替；
- 存储默认使用 MinIO；
- 数据量小；
- 不配置真实 OAuth 第三方回调。

## 生产发布设计

### 镜像策略

每次发布递增 tag：

```text
server:v10
client:v7
```

禁止覆盖已推送 tag。旧 tag 保留用于回滚。

### 迁移策略

PostgreSQL 备份必须先完成。迁移顺序：

```text
stop API / worker / frontend
→ run prisma migrate deploy
→ prisma migrate status
→ start postgres + redis
→ start API / worker / frontend
```

当前新增迁移是 additive：

- `20260925000000_pgvector_text_embeddings`
- `20260926000000_documents_and_chunks`
- `20260926220000_unified_document_index`

这些迁移会创建扩展、表和索引，不删除既有业务表。

### 环境变量策略

生产 `.env` 必须包含：

- PostgreSQL / Redis / JWT；
- storage driver 与对象存储凭据；
- `SILICONFLOW_API_KEY`、`SILICONFLOW_API_URL`、`SILICONFLOW_EMBEDDING_MODEL`、`EMBEDDING_DIMENSIONS`；
- `DEEPSEEK_API_KEY`、`LLM_API_URL`、`LLM_MODEL`、`LLM_MAX_TOKENS`、`LLM_TEMPERATURE`；
- CORS 与 OAuth callback；
- 上传 pipeline 参数。

禁止把真实 `.env` 提交 Git。

### 冒烟策略

上线后按固定顺序验证：

1. 前端打开；
2. `/api/auth/providers` 返回 JSON；
3. 登录；
4. 上传 Markdown；
5. 等待 `indexed`；
6. RAG 问题返回 `sources → delta → done`；
7. 引用编号不越界；
8. 无关问题输出固定兜底；
9. 空 workspace 不泄露；
10. worker 日志无 embedding 或维度错误。

### 回滚策略

优先回滚应用镜像：

```text
stop nestjs / server-worker / nextjs
→ compose image tag 改回 server:v9 / client:v6
→ up -d
```

不主动回滚数据库。只有迁移破坏数据且应用回滚不可用时，才使用发布前 `pg_dump` 恢复。

## 风险与控制

| 风险                    | 影响               | 控制                                                             |
| ----------------------- | ------------------ | ---------------------------------------------------------------- |
| 新迁移失败              | 服务不可用         | 先备份；stop app；`migrate deploy`；失败恢复备份                 |
| pgvector 镜像不兼容     | extension 缺失     | 生产 compose 使用 `pgvector/pgvector:pg16`，演练先验证 extension |
| API key 配错            | 上传索引或问答失败 | 演练先验证；上线检查 worker 日志                                 |
| SSE 被 proxy 缓冲       | 前端不流式         | Next 同源 rewrite；Nginx 不缓冲；生产 SSE 冒烟                   |
| worker 未启动           | 文档不 indexed     | compose 单独服务；检查 BullMQ 日志                               |
| Next rewrite 打不到 API | 全站 API 404       | 演练验证登录、上传、问答                                         |
| 旧镜像被覆盖            | 无法回滚           | 每次 tag 递增，不覆盖                                            |
| 生产数据被误删          | 数据丢失           | 只对冒烟 workspace 操作；不清理生产默认数据                      |

## 验收标准

D6 完成必须同时满足：

1. 发布 commit 已推送到 GitHub；
2. server / client tests、typecheck、build 通过；
3. 本地生产演练通过；
4. server / client 镜像构建并推送到阿里云仓库；
5. 生产 PostgreSQL 已备份；
6. `prisma migrate status` 无 pending；
7. API、worker、frontend 运行；
8. 生产上传文件可 `indexed`；
9. RAG SSE 正常且引用正确；
10. 无关问题兜底；
11. 空 workspace 不泄露；
12. README、架构文档、部署文档已更新；
13. 回滚步骤可执行。
