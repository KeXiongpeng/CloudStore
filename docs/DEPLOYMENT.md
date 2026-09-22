# 部署说明

## 环境变量

不要把真实生产密钥提交到 Git。最低限度需要在 `.env` 中配置：

```env
POSTGRES_USER=csp_user
POSTGRES_PASSWORD=change-me-strong-password
POSTGRES_DB=cloud_storage

DATABASE_URL=postgresql://csp_user:change-me-strong-password@postgres:5432/cloud_storage?schema=public

REDIS_HOST=redis
REDIS_PORT=6379

JWT_SECRET=change-me-long-random-string
JWT_REFRESH_SECRET=change-me-another-long-random-string

QINIU_ACCESS_KEY=your-qiniu-access-key
QINIU_SECRET_KEY=your-qiniu-secret-key
QINIU_BUCKET=your-bucket
QINIU_ENDPOINT=https://s3.cn-east-1.qiniucs.com
QINIU_CDN_DOMAIN=https://your-cdn-domain

APP_URL=https://kxpwty.cn
FRONTEND_URL=https://kxpwty.cn
CORS_ORIGIN=https://kxpwty.cn

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_REDIRECT_URI=https://kxpwty.cn/api/auth/github/callback

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://kxpwty.cn/api/auth/google/callback

WECHAT_CLIENT_ID=
WECHAT_CLIENT_SECRET=
WECHAT_REDIRECT_URI=https://kxpwty.cn/api/auth/wechat/callback

ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-admin-password
DEMO_EMAIL=demo@example.com
DEMO_PASSWORD=change-me-demo-password
```

生产环境必须替换全部示例密码和空值。

---

## 本地完整容器部署

`docker-compose.yml` 会启动：

- Nginx
- Next.js
- NestJS
- PostgreSQL
- Redis

```bash
cp .env.example .env
docker compose up -d --build
```

访问：

```text
http://localhost
```

首次部署需要执行数据库迁移：

```bash
docker compose exec nestjs npx prisma migrate deploy
docker compose exec nestjs npm run prisma:seed
```

---

## 开发数据库 / Redis

只启动依赖服务：

```bash
docker compose -f docker-compose.dev.yml up -d
```

端口映射：

| 服务       | 宿主机端口 | 容器端口 |
| ---------- | ---------- | -------- |
| PostgreSQL | `5433`     | `5432`   |
| Redis      | `6380`     | `6379`   |

---

## 生产部署

`docker-compose.prod.yml` 使用预构建镜像，并接入外部共享 Nginx Proxy：

```text
前端：kxpwty.cn
后端：api.kxpwty.cn
```

在服务器项目目录准备 `.env` 后执行：

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec nestjs npx prisma migrate deploy
```

首次初始化演示数据：

```bash
docker compose -f docker-compose.prod.yml exec nestjs npm run prisma:seed
```

查看服务状态：

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f nestjs
docker compose -f docker-compose.prod.yml logs -f nextjs
```

---

## OAuth 生产配置

| Provider | Production Callback URL                      |
| -------- | -------------------------------------------- |
| GitHub   | `https://kxpwty.cn/api/auth/github/callback` |
| Google   | `https://kxpwty.cn/api/auth/google/callback` |
| WeChat   | `https://kxpwty.cn/api/auth/wechat/callback` |

注意事项：

1. 第三方平台中的回调地址必须与上面完全一致。
2. 本地地址只能配置在 GitHub / Google 的开发应用中。
3. 微信网站应用需要微信开放平台审核通过的 `AppID` / `AppSecret`。
4. 未配置微信凭证时，前端不会显示微信登录按钮。

---

## 健康检查与验证

检查前端：

```bash
curl -I https://kxpwty.cn
```

检查后端 provider 配置：

```bash
curl https://kxpwty.cn/api/auth/providers
```

检查数据库迁移状态：

```bash
docker compose -f docker-compose.prod.yml exec nestjs npx prisma migrate status
```

---

## 更新流程

```bash
git pull
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec nestjs npx prisma migrate deploy
```

如有前端镜像更新，确保重新拉取或重建 `nextjs` 服务。
