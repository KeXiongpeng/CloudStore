# 部署说明

## 环境变量

不要把真实生产密钥提交到 Git。生产 `.env` 至少需要：

```env
POSTGRES_USER=csp_user
POSTGRES_PASSWORD=change-me-strong-password
POSTGRES_DB=cloud_storage

DATABASE_URL=postgresql://csp_user:change-me-strong-password@postgres:5432/cloud_storage?schema=public

REDIS_HOST=redis
REDIS_PORT=6379

JWT_SECRET=change-me-long-random-string
JWT_REFRESH_SECRET=change-me-another-long-random-string

APP_URL=https://cloudstore.kxpwty.cn
FRONTEND_URL=https://cloudstore.kxpwty.cn
CORS_ORIGIN=https://cloudstore.kxpwty.cn

STORAGE_DRIVER=qiniu
QINIU_ACCESS_KEY=your-real-access-key
QINIU_SECRET_KEY=your-real-secret-key
QINIU_BUCKET=your-real-bucket
QINIU_ENDPOINT=https://s3.cn-east-1.qiniucs.com
QINIU_CDN_DOMAIN=https://your-cdn-domain

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-admin-password
DEMO_EMAIL=demo@example.com
DEMO_PASSWORD=change-me-demo-password

SILICONFLOW_API_KEY=your-real-siliconflow-key
SILICONFLOW_API_URL=https://api.siliconflow.cn/v1/embeddings
SILICONFLOW_EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DIMENSIONS=1024

DEEPSEEK_API_KEY=your-real-deepseek-key
LLM_API_URL=https://api.deepseek.com/chat/completions
LLM_MODEL=deepseek-chat
LLM_MAX_TOKENS=1024
LLM_TEMPERATURE=0.2

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=https://cloudstore.kxpwty.cn/api/auth/github/callback

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://cloudstore.kxpwty.cn/api/auth/google/callback

WECHAT_CLIENT_ID=
WECHAT_CLIENT_SECRET=
WECHAT_REDIRECT_URI=https://cloudstore.kxpwty.cn/api/auth/wechat/callback
```

如果选择 MinIO 自托管，则设置：

```env
STORAGE_DRIVER=minio
MINIO_ENDPOINT=http://minio:9000
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY=change-me
MINIO_SECRET_KEY=change-me
MINIO_BUCKET=cloudstore-prod
# Browser-reachable endpoint used to sign direct upload / preview URLs.
# Required when MINIO_ENDPOINT is only reachable inside the container network.
MINIO_PUBLIC_ENDPOINT=https://minio.example.com
```

`SILICONFLOW_API_KEY` 只用于 Embedding；`DEEPSEEK_API_KEY` 只用于 Chat / judge / rewrite，两者不能混用。

## Compose 文件

| 文件                      | 用途                                                                         |
| ------------------------- | ---------------------------------------------------------------------------- |
| `docker-compose.dev.yml`  | 本地开发依赖：PostgreSQL + pgvector、Redis、MinIO、dev worker                |
| `docker-compose.yml`      | 单机完整部署：Nginx、Next.js、NestJS、PostgreSQL + pgvector、Redis           |
| `docker-compose.prod.yml` | 生产预构建镜像：NestJS、server-worker、Next.js、PostgreSQL + pgvector、Redis |

生产 compose 接入外部 shared Nginx Proxy，前端域名：

```text
https://cloudstore.kxpwty.cn
```

浏览器请求同源 `/api/*`，由 Next.js rewrite 转发到容器内 `http://nestjs:3000`。

## 生产发布流程

### 1. 冻结发布 commit

确认本地已通过：

```bash
cd server
npm run test
npm run typecheck
npm run build

cd ../client
npm run test
npx tsc --noEmit
npm run build
```

记录发布 commit SHA：

```bash
git rev-parse HEAD
```

### 2. 构建并推送镜像

镜像 tag 必须随发布递增，不要复用旧 tag。例如：

```bash
SERVER_IMAGE=crpi-7znqdwo2lmmjl5kg.cn-shenzhen.personal.cr.aliyuncs.com/cloud-storage/server:v10
CLIENT_IMAGE=crpi-7znqdwo2lmmjl5kg.cn-shenzhen.personal.cr.aliyuncs.com/cloud-storage/client:v7

docker build -t "$SERVER_IMAGE" server
docker build \
  --build-arg BACKEND_URL=http://nestjs:3000 \
  -t "$CLIENT_IMAGE" client

docker push "$SERVER_IMAGE"
docker push "$CLIENT_IMAGE"
```

推送前同步修改 `docker-compose.prod.yml` 中的 server 和 client image tag。

### 3. 服务器更新代码

```bash
cd /path/to/cloudstore
git fetch
git checkout <release-sha>
```

不要使用未打 tag 的浮动 `main` 直接部署，除非你明确接受该风险。

### 4. 备份 PostgreSQL

在修改镜像或迁移前先备份：

```bash
set -a
source .env
set +a

docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  > "backup-${POSTGRES_DB}-$(date +%Y%m%d%H%M%S).sql"
```

备份完成后检查文件非空，并在异地或对象存储保留一份。

### 5. 拉取新镜像并校验 compose

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml config
```

### 6. 执行数据库迁移

推荐先只启动数据库和 Redis，再执行迁移：

```bash
docker compose -f docker-compose.prod.yml up -d postgres redis
docker compose -f docker-compose.prod.yml exec nestjs npx prisma migrate deploy
docker compose -f docker-compose.prod.yml exec nestjs npx prisma migrate status
```

如果旧 API 容器还在运行，请先停止 API 与 worker，再执行迁移：

```bash
docker compose -f docker-compose.prod.yml stop nestjs server-worker nextjs
docker compose -f docker-compose.prod.yml run --rm nestjs npx prisma migrate deploy
```

### 7. 启动全部服务

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

确认至少这些服务健康或运行中：

- `postgres`
- `redis`
- `nestjs`
- `server-worker`
- `nextjs`

### 8. 查看日志

```bash
docker compose -f docker-compose.prod.yml logs -f nestjs
docker compose -f docker-compose.prod.yml logs -f server-worker
docker compose -f docker-compose.prod.yml logs -f nextjs
```

重点检查：

- Prisma connected；
- Redis connected；
- BullMQ worker ready；
- 无重复 migration 报错；
- 无 storage credentials 报错；
- 无 AI API key 错误。

## 生产冒烟测试

### 1. 基础可用性

```bash
curl -I https://cloudstore.kxpwty.cn
curl https://cloudstore.kxpwty.cn/api/auth/providers
```

前端应返回 HTTP 200；providers 应返回 JSON。

### 2. 登录与会话

- 打开 `https://cloudstore.kxpwty.cn/login`；
- 使用非演示生产账号登录；
- 刷新页面后会话不丢失；
- 退出后再访问受保护页面跳转登录。

### 3. 知识库上传与索引

1. 创建或选择一个冒烟测试 workspace。
2. 上传一篇小型 Markdown。
3. 等待文件状态变为 `indexed`。
4. 确认知识库检索能命中该文档。

### 4. RAG 问答

在同一 workspace 提问文档中明确存在的问题：

- 返回状态为流式；
- 事件顺序为 `sources → delta... → done`；
- 回答包含 `[1]` 类引用；
- 引用标题与上传文档一致；
- 引用不是越界编号。

### 5. 兜底与隔离

- 提问一个知识库明显没有的问题，确认输出固定兜底；
- 在空 workspace 提问相同问题，确认 `sources` 为空且不泄露其他 workspace 内容；
- 提问一次口语化表达，观察是否仍能命中目标文档。

### 6. Worker 验证

上传后查看 worker 日志：

```bash
docker compose -f docker-compose.prod.yml logs -f server-worker
```

确认出现 document index completed，且没有 Embedding 鉴权或维度错误。

## 首次初始化演示数据

仅在确认允许创建演示账号时执行：

```bash
docker compose -f docker-compose.prod.yml exec nestjs npm run prisma:seed
```

生产环境必须在 `.env` 中替换管理员和演示账号密码。

## OAuth 生产配置

| Provider | Callback URL                                            |
| -------- | ------------------------------------------------------- |
| GitHub   | `https://cloudstore.kxpwty.cn/api/auth/github/callback` |
| Google   | `https://cloudstore.kxpwty.cn/api/auth/google/callback` |
| WeChat   | `https://cloudstore.kxpwty.cn/api/auth/wechat/callback` |

第三方平台中的回调地址必须完全一致。

## 回滚

优先回滚应用镜像，不轻易回滚数据库：

```bash
# 1. 停止新版本应用
docker compose -f docker-compose.prod.yml stop nestjs server-worker nextjs

# 2. 切回上一个镜像 tag
#    编辑 docker-compose.prod.yml 中的 server / client image

# 3. 启动旧版本
docker compose -f docker-compose.prod.yml up -d nestjs server-worker nextjs
```

只有当迁移破坏数据且应用回滚不可用时，才恢复数据库：

```bash
docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  < backup.sql
```

恢复数据库前先停止所有写入服务，并确认备份文件完整。

## 发布检查清单

- [ ] 发布 commit 已推送到 GitHub；
- [ ] server tests / typecheck / build 通过；
- [ ] client tests / typecheck / build 通过；
- [ ] 镜像 tag 已递增；
- [ ] `.env` 包含 RAG 与存储全部变量；
- [ ] PostgreSQL 已备份且备份非空；
- [ ] `prisma migrate status` 无 pending migration；
- [ ] API、worker、frontend 全部运行；
- [ ] 上传文件能变成 `indexed`；
- [ ] RAG SSE 正常且引用正确；
- [ ] 无关问题兜底；
- [ ] 空 workspace 不泄露数据；
- [ ] 旧镜像 tag 仍可用于回滚。

## D7 prod-like rehearsal record (2026-09-29)

1. 备份本地 prod-like 数据库：`backups/prod-local-pre-d7-chat-session.sql`。
2. 重建本地 prod-like server/client 镜像。
3. 执行 migration：`20260929160000_chat_sessions`。
4. `GET /api/workspaces/:id/knowledge/stats` 未授权返回 401，授权返回 indexed/processing/failed/pending 统计。
5. SSE 首问顺序：`session → sources → actions → delta → done`。
6. 携带返回 `sessionId` 追问，最新 session 共 4 条消息（2 user + 2 assistant），确认第二轮复用同一 session。
7. 空知识库引导返回 action cards，且事件中不暴露 `workspaceId`。

生产部署前仍必须重新备份生产数据库；本次改动只完成本地 prod-like，不包含生产发布。
