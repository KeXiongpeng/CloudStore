# 云存储文件分享平台 — 设计文档

> 上传文件，获取网络地址，他人打开链接即可在线预览和下载。

---

## 一、项目概述

基于 S3 协议的云存储文件分享平台。用户上传图片、视频、文档等资源后获得一个网络地址，任何人打开该地址即可在线预览和下载文件。

### 技术栈

| 层       | 技术                                                    |
| -------- | ------------------------------------------------------- |
| 前端     | React + Next.js (App Router) + TailwindCSS + TypeScript |
| 后端     | NestJS + TypeScript                                     |
| 数据库   | PostgreSQL                                              |
| 缓存     | Redis                                                   |
| 对象存储 | 七牛云 S3 兼容接口（@aws-sdk/client-s3）                |
| 部署     | Docker Compose + Nginx 反向代理，部署到阿里云 ECS       |

### 核心需求

| 维度     | 决策                                                    |
| -------- | ------------------------------------------------------- |
| 用户模式 | 多用户注册制                                            |
| 认证方式 | JWT 鉴权 + OAuth2（GitHub/Google）                      |
| 存储限额 | 等级配额制（普通/VIP）                                  |
| 上传方式 | 网页拖拽/选择、API + ShareX 集成、大文件分片上传        |
| 文件类型 | 图片 / 视频 / 文档 / 压缩包（全类型）                   |
| 返回 URL | 原始文件名链接（如 `/f/photo.jpg`）                     |
| 管理功能 | 文件管理面板、访问/下载统计                             |
| 上传路径 | 混合模式（小文件前端直传七牛云，大文件后端中转 + 分片） |
| 公开预览 | 任何人打开链接可在线预览/下载，无需登录                 |

---

## 二、系统架构

前后端分离架构：Next.js 纯前端 SSR + NestJS 独立 API 服务。

```
                           ┌─────────────────────────────────────┐
                           │          阿里云 ECS 服务器            │
                           │                                     │
   用户浏览器 ──HTTPS──→ Nginx ──/api/*──→ NestJS API Server     │
          │              │              │         │              │
          │              └──/*────→ Next.js SSR│    ┌───┐        │
          │                             │       │   │R  │        │
          │                             │       │   │e  │        │
          │                             │       │   │d  │        │
          │                             │       │   │i  │        │
          │                             │       │   │s  │        │
          │                             │       │   └───┘        │
          │                             │       │   ┌───┐        │
          │    小文件直传 ←──Presigned URL      │   │P  │        │
          │──────────────────────────────────→ 七牛云 S3   │o  │        │
                           │                   s t g r  │        │
                           └──────────────────────────────│        │
```

### Docker Compose 容器编排

```yaml
services:
  nginx: # 反向代理 + SSL 终止
    ports: ['443:443', '80:80']
  nextjs: # 前端 SSR
  nestjs: # 后端 API
  postgres: # 数据库（持久化卷）
  redis: # 缓存
```

---

## 三、数据库设计（PostgreSQL）

### users 表

| 字段          | 类型              | 说明                         |
| ------------- | ----------------- | ---------------------------- |
| id            | UUID PK           | 主键                         |
| email         | VARCHAR UNIQUE    | 邮箱                         |
| password_hash | VARCHAR           | 密码哈希（OAuth 用户可为空） |
| nickname      | VARCHAR           | 昵称                         |
| avatar_url    | VARCHAR           | 头像地址                     |
| role          | ENUM(user, admin) | 角色                         |
| tier          | ENUM(free, vip)   | 用户等级                     |
| created_at    | TIMESTAMP         | 创建时间                     |
| updated_at    | TIMESTAMP         | 更新时间                     |

### oauth_accounts 表

| 字段        | 类型                 | 说明          |
| ----------- | -------------------- | ------------- |
| id          | UUID PK              | 主键          |
| user_id     | UUID FK → users      | 关联用户      |
| provider    | ENUM(github, google) | OAuth 提供商  |
| provider_id | VARCHAR              | 提供商用户 ID |
| created_at  | TIMESTAMP            | 创建时间      |

### files 表

| 字段           | 类型                  | 说明                                       |
| -------------- | --------------------- | ------------------------------------------ |
| id             | UUID PK               | 主键                                       |
| user_id        | UUID FK → users       | 上传者                                     |
| original_name  | VARCHAR               | 原始文件名                                 |
| storage_key    | VARCHAR UNIQUE        | 七牛云存储 Key（如 `users/123/photo.jpg`） |
| url_key        | VARCHAR UNIQUE        | URL 标识（如 `photo.jpg`）                 |
| file_size      | BIGINT                | 文件大小（字节）                           |
| mime_type      | VARCHAR               | MIME 类型                                  |
| is_private     | BOOLEAN DEFAULT false | 是否私有（私有文件不可公开预览）           |
| view_count     | INT DEFAULT 0         | 浏览次数                                   |
| download_count | INT DEFAULT 0         | 下载次数                                   |
| upload_ip      | VARCHAR               | 上传 IP                                    |
| created_at     | TIMESTAMP             | 上传时间                                   |
| deleted_at     | TIMESTAMP NULL        | 软删除时间                                 |

### user_quotas 表

| 字段          | 类型                   | 说明             |
| ------------- | ---------------------- | ---------------- |
| id            | UUID PK                | 主键             |
| user_id       | UUID FK → users UNIQUE | 关联用户         |
| storage_limit | BIGINT                 | 存储上限（字节） |
| storage_used  | BIGINT DEFAULT 0       | 已用存储（字节） |
| tier          | ENUM(free, vip)        | 配额等级         |
| updated_at    | TIMESTAMP              | 更新时间         |

默认配额：free = 500MB，vip = 10GB。

### api_keys 表

| 字段       | 类型            | 说明                    |
| ---------- | --------------- | ----------------------- |
| id         | UUID PK         | 主键                    |
| user_id    | UUID FK → users | 关联用户                |
| name       | VARCHAR         | 密钥名称（如 "ShareX"） |
| key_hash   | VARCHAR         | 密钥哈希（不存储明文）  |
| last_used  | TIMESTAMP NULL  | 最后使用时间            |
| created_at | TIMESTAMP       | 创建时间                |

### access_logs 表

| 字段        | 类型                 | 说明      |
| ----------- | -------------------- | --------- |
| id          | UUID PK              | 主键      |
| file_id     | UUID FK → files      | 关联文件  |
| ip          | VARCHAR              | 访问者 IP |
| action      | ENUM(view, download) | 行为类型  |
| accessed_at | TIMESTAMP            | 访问时间  |

---

## 四、核心业务流程

### 4.1 认证流程

```
邮箱注册/登录:
  POST /api/auth/register  → 创建用户 + 初始化配额
  POST /api/auth/login     → 验证密码 → 返回 JWT (access + refresh)

OAuth2 登录:
  GET  /api/auth/github    → 重定向到 GitHub 授权页
  GET  /api/auth/callback  → GitHub 回调 → 查找/创建用户 → 返回 JWT

JWT 鉴权:
  - Access Token: 有效期 15 分钟，放在请求头 Authorization: Bearer <token>
  - Refresh Token: 有效期 7 天，存储在 Redis（key: user:{userId}:refresh）
  - 过期后用 Refresh Token 换取新 Access Token
```

### 4.2 文件上传流程（混合模式）

阈值：**5MB**，≤5MB 走前端直传，>5MB 走后端中转 + 分片。

**小文件（≤ 5MB）— 前端直传**:

```
1. 前端 POST /api/files/presign → 请求上传凭证
2. NestJS 检查配额 → 生成七牛云 Presigned PUT URL → 返回给前端
3. 前端直接 PUT 文件到七牛云 S3
4. 前端 POST /api/files/callback → 通知上传完成
5. NestJS 验证文件存在 → 记录元数据到 PostgreSQL → 更新配额
```

**大文件（> 5MB）— 后端中转 + 分片上传**:

```
1. 前端 POST /api/files/upload-init → 请求初始化分片上传
2. NestJS 调用 S3 CreateMultipartUpload → 返回 uploadId + 分片信息
3. 前端将文件分片（每片 2MB）
4. 逐片 POST /api/files/upload-part → 上传分片到 NestJS → NestJS 转发到七牛云
5. 全部分片完成后 POST /api/files/upload-complete → NestJS 调用 S3 CompleteMultipartUpload
6. NestJS 记录元数据到 PostgreSQL → 更新配额
```

### 4.3 文件预览流程

```
任何人打开 /f/:urlKey（无需登录）
  1. Next.js SSR 渲染预览页（SEO 友好）
  2. 前端 GET /api/public/files/:urlKey → 获取文件元数据
  3. 根据 mime_type 选择渲染组件：
     - 图片 → 图片查看器（缩放、拖拽）
     - 视频 → HTML5 视频播放器
     - 音频 → HTML5 音频播放器
     - PDF  → PDF 阅读器
     - 代码 → 语法高亮查看器
     - 文本 → 纯文本渲染
     - 其他 → 文件信息卡 + 下载按钮
  4. 异步 POST /api/public/files/:urlKey/view → 记录浏览次数
  5. 用户点击下载 → GET /api/public/files/:urlKey/download → 记录下载 → 重定向到七牛云
```

---

## 五、API 设计

### 5.1 认证模块 `/api/auth`

| 方法 | 路径      | 说明                     | 鉴权          |
| ---- | --------- | ------------------------ | ------------- |
| POST | /register | 邮箱注册                 | 无            |
| POST | /login    | 邮箱登录                 | 无            |
| GET  | /github   | GitHub OAuth2 入口       | 无            |
| GET  | /google   | Google OAuth2 入口       | 无            |
| GET  | /callback | OAuth 回调               | 无            |
| POST | /refresh  | 刷新 Access Token        | Refresh Token |
| POST | /logout   | 登出，清除 Refresh Token | JWT           |

### 5.2 文件模块 `/api/files`

| 方法   | 路径             | 说明                               | 鉴权                |
| ------ | ---------------- | ---------------------------------- | ------------------- |
| POST   | /presign         | 获取直传凭证（≤5MB）               | JWT                 |
| POST   | /upload-init     | 初始化分片上传（>5MB）             | JWT                 |
| POST   | /upload-part     | 上传单个分片                       | JWT                 |
| POST   | /upload-complete | 完成分片合并                       | JWT                 |
| POST   | /callback        | 直传完成回调                       | JWT                 |
| GET    | /                | 获取当前用户文件列表（分页、筛选） | JWT                 |
| GET    | /:id             | 获取文件详情                       | JWT（仅文件所有者） |
| DELETE | /:id             | 删除文件（软删除）                 | JWT（仅文件所有者） |
| GET    | /stats           | 当前用户访问统计概览               | JWT                 |

### 5.3 公共接口 `/api/public`

| 方法 | 路径                    | 说明                     | 鉴权 |
| ---- | ----------------------- | ------------------------ | ---- |
| GET  | /files/:urlKey          | 获取文件元数据（公开）   | 无   |
| POST | /files/:urlKey/view     | 记录浏览                 | 无   |
| GET  | /files/:urlKey/download | 记录下载，重定向到七牛云 | 无   |

### 5.4 API 密钥模块 `/api/keys`

| 方法   | 路径 | 说明                             | 鉴权 |
| ------ | ---- | -------------------------------- | ---- |
| POST   | /    | 创建 API Key（返回明文，仅一次） | JWT  |
| GET    | /    | 获取密钥列表                     | JWT  |
| DELETE | /:id | 删除密钥                         | JWT  |

ShareX 通过 API Key + `/api/files/presign` 或自定义上传接口上传文件。

### 5.5 用户模块 `/api/users`

| 方法  | 路径         | 说明             | 鉴权 |
| ----- | ------------ | ---------------- | ---- |
| GET   | /me          | 获取当前用户信息 | JWT  |
| PATCH | /me          | 更新昵称/头像    | JWT  |
| PATCH | /me/password | 修改密码         | JWT  |
| GET   | /me/quota    | 获取配额使用情况 | JWT  |

### 5.6 管理后台 `/api/admin`

| 方法   | 路径       | 说明                             | 鉴权  |
| ------ | ---------- | -------------------------------- | ----- |
| GET    | /users     | 用户列表（分页）                 | Admin |
| PATCH  | /users/:id | 修改用户等级/角色                | Admin |
| DELETE | /users/:id | 禁用用户                         | Admin |
| GET    | /stats     | 全局统计（总用户/总文件/总存储） | Admin |

---

## 六、前端页面设计

### 6.1 公开页面（无需登录）

| 路由                    | 说明                              |
| ----------------------- | --------------------------------- |
| `/`                     | 首页（产品介绍 + CTA）            |
| `/login`                | 登录页                            |
| `/register`             | 注册页                            |
| `/auth/callback`        | OAuth 回调处理页                  |
| `/f/:urlKey`            | **文件预览页**（核心页面）        |
| `/d/:urlKey`            | 直接下载跳转                      |
| `/f/:urlKey?embed=true` | 嵌入模式（iframe 用，无页面框架） |

### 6.2 用户页面（需登录）

| 路由         | 说明                                            |
| ------------ | ----------------------------------------------- |
| `/dashboard` | 控制面板（存储用量概览 + 快速上传入口）         |
| `/upload`    | 上传页（拖拽区域 + 批量上传 + 进度）            |
| `/files`     | 文件管理（列表/网格视图，搜索，删除，复制链接） |
| `/files/:id` | 文件详情（预览 + 访问/下载统计）                |
| `/api-keys`  | API 密钥管理（创建/删除，ShareX 配置导出）      |
| `/settings`  | 个人设置（昵称/头像/密码）                      |

### 6.3 管理页面（需 Admin）

| 路由     | 说明                            |
| -------- | ------------------------------- |
| `/admin` | 管理后台（用户管理 + 全局统计） |

### 6.4 文件预览页组件渲染策略

| MIME 类型                                 | 渲染组件     | 功能                                                |
| ----------------------------------------- | ------------ | --------------------------------------------------- |
| image/*                                   | ImageViewer  | 缩放、拖拽、适应屏幕、查看原图                      |
| video/*                                   | VideoPlayer  | 播放/暂停、进度条、音量、全屏                       |
| audio/*                                   | AudioPlayer  | 播放控制、进度条                                    |
| application/pdf                           | PDFViewer    | 翻页、缩放                                          |
| text/*, application/json, application/xml | CodeViewer   | 语法高亮、行号                                      |
| text/csv                                  | TableView    | 表格渲染                                            |
| 其他所有类型                              | FileInfoCard | 文件图标 + 名称 + 大小 + 类型 + 上传时间 + 下载按钮 |

预览页操作栏：下载按钮、复制链接、分享二维码。

---

## 七、缓存策略（Redis）

| Key 模式                  | 用途                      | TTL         |
| ------------------------- | ------------------------- | ----------- |
| `user:{userId}:refresh`   | 存储 Refresh Token        | 7 天        |
| `user:{userId}:quota`     | 用户配额缓存              | 写入时更新  |
| `presign:{uploadId}`      | 七牛云 Presigned URL 缓存 | 5 分钟      |
| `multipart:{uploadId}`    | 分片上传状态（Hash）      | 24 小时     |
| `file:{fileId}:views`     | 文件浏览计数（INCR）      | 定时刷入 PG |
| `file:{fileId}:downloads` | 文件下载计数（INCR）      | 定时刷入 PG |
| `rate:{ip}`               | IP 限流计数               | 1 分钟      |

---

## 八、七牛云 S3 对接

使用七牛云 S3 兼容接口，通过 `@aws-sdk/client-s3` 对接。

```typescript
const s3Client = new S3Client({
  endpoint: 'https://s3.cn-east-1.qiniu.com',
  region: 'cn-east-1',
  credentials: {
    accessKeyId: process.env.QINIU_ACCESS_KEY,
    secretAccessKey: process.env.QINIU_SECRET_KEY,
  },
  forcePathStyle: true,
});
```

文件存储路径规则：`{userId}/{year}/{month}/{filename}`

---

## 九、安全设计

- 密码：bcrypt 哈希，salt rounds = 10
- API Key：SHA-256 哈希存储，明文仅创建时返回一次
- JWT：HS256 签名，密钥存储在环境变量
- 上传校验：文件类型白名单、文件大小限制、MIME 类型验证
- IP 限流：Redis 计数器，公共接口 60 次/分钟，上传接口 10 次/分钟
- CORS：Nginx 层配置，仅允许前端域名
- SQL 注入：使用 Prisma/TypeORM 参数化查询
- XSS：前端输出转义，CSP 头

---

## 十、参考项目

| 项目                  | Stars | 参考点                                        |
| --------------------- | ----- | --------------------------------------------- |
| Cloudreve             | ~22k  | 多存储后端架构、文件管理 UI                   |
| Void                  | 222   | React + Next.js + Docker、ShareX 集成、短链接 |
| s3-image-upload-thing | 较新  | S3 对接、自动图片处理、Docker 部署            |
| Chevereto             | ~950  | 文件预览页面、相册/分类、访问统计             |
| LitePic               | 52    | S3 远程存储、WebAuthn、异步处理队列           |
