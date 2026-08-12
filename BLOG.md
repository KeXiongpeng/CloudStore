# CloudStore - 全栈云存储文件分享平台

> 一个基于 Next.js + NestJS + PostgreSQL + Redis + 七牛云 S3 构建的全栈云存储文件分享平台，支持文件上传、在线预览、外链分享、OAuth 登录、管理后台等完整功能。已部署上线：[kxpwty.cn](https://kxpwty.cn)

## 技术栈

| 层次 | 技术选型 | 说明 |
|------|----------|------|
| 前端 | Next.js 14 + React 18 + Tailwind CSS | App Router、Standalone 输出模式 |
| 后端 | NestJS 10 + Prisma 5 + Passport | 全局 `/api` 前缀、JWT + OAuth 认证 |
| 数据库 | PostgreSQL 16 | 用户、文件、配额、OAuth、访问日志 |
| 缓存 | Redis 7 (ioredis) | 分片上传会话、Refresh Token、PV 计数 |
| 对象存储 | 七牛云 S3 兼容接口 | AWS SDK v3、预签名上传/下载 |
| 部署 | Docker Compose + Nginx + Let's Encrypt | 阿里云 ECS、多容器编排、自动 HTTPS |

## 核心功能

### 1. 双策略文件上传

针对不同文件大小采用两种上传策略，平衡速度与可靠性：

**小文件（≤ 5MB）-- 预签名直传 S3**

```
前端请求预签名URL → 后端生成PUT签名 → 前端XHR直传S3(带进度) → 回调确认写入数据库
```

- 通过 `XMLHttpRequest` 实现真实上传进度监听
- 预签名 URL 有效期 300 秒（5 分钟）
- 零后端带宽消耗，直传 S3

**大文件（> 5MB）-- 后端代理分片上传**

```
初始化分片 → 逐片(2MB/片)经后端代理上传S3 → 合并分片 → 写入数据库
```

- 分片大小 2MB，经后端中转确保安全性
- Redis 维护上传会话状态（TTL 24h），支持断点续传潜力
- 上传完成后自动清理 Redis 会话

### 2. 文件在线预览

支持 6 种文件类型的页内预览，无需下载：

| 类型 | 预览方式 | 组件 |
|------|----------|------|
| 图片 | 页内大图查看器（支持缩放） | ImageViewer |
| 视频 | HTML5 Video Player | VideoPlayer |
| 音频 | HTML5 Audio Player | AudioPlayer |
| PDF | iframe 嵌入 | PdfViewer |
| 代码 | 语法高亮 + 行号显示 | CodeViewer |
| 其他 | 文件信息卡片 | FileInfoCard |

预览弹窗顶部工具栏提供"新窗口打开"和"下载"功能，点击下载直接 302 重定向到 S3 预签名下载链接。

### 3. 认证体系

**JWT 双 Token 机制**

| Token | 有效期 | 用途 |
|-------|--------|------|
| Access Token | 15 分钟 | API 请求鉴权，Header 携带 |
| Refresh Token | 7 天 | 刷新 Access Token，存储在 Redis |

前端 Axios 拦截器自动处理 Token 刷新：401 触发 → 用 Refresh Token 换新 → 重放失败队列中的请求，整个过程对用户无感知。

**OAuth 第三方登录**

支持 GitHub 和 Google OAuth，流程：

```
点击第三方登录 → 后端重定向授权页 → 用户授权 → 回调获取用户信息 → 关联/创建用户 → 重定向前端并携带Token
```

OAuth 用户与邮箱用户自动关联：同一邮箱下不同登录方式共享同一账户。

### 4. 权限与配额模型

**用户角色**

| 角色 | 权限 |
|------|------|
| user | 上传、管理自己的文件、查看配额 |
| admin | 所有 user 权限 + 用户管理、平台统计、禁用用户 |

**存储配额**

| 等级 | 存储上限 |
|------|----------|
| Free | 500 MB |
| VIP | 10 GB |

上传前校验配额，删除文件后自动回退已用空间，配额状态通过进度条可视化展示。

### 5. 公开分享与 SEO

每个上传的文件生成唯一的 32 位随机 `urlKey`，支持以下公开访问方式：

- `/f/[urlKey]` -- 文件预览页，SSR 生成 OpenGraph 元数据（支持社交媒体分享预览）
- `/f/[urlKey]/embed` -- 嵌入式预览（iframe 场景，黑底风格）
- `/d/[urlKey]` -- 短链下载页

### 6. 管理后台

Admin 角色专属，提供：
- 用户列表（分页、角色/等级变更、禁用）
- 平台统计（用户数、文件数、存储用量）

## 数据库设计

6 个核心数据模型：

```
users           -- 用户表（邮箱、密码哈希、角色、等级）
oauth_accounts  -- OAuth关联表（provider、providerId）
files           -- 文件表（storageKey、urlKey、软删除、PV/下载计数）
user_quotas     -- 用户配额表（storageLimit、storageUsed）
access_logs     -- 访问日志（IP、action、时间）
```

使用 Prisma ORM 管理，PostgreSQL 16 存储。

## 前端页面结构

```
/                    → 首页（产品介绍 + 登录/注册入口）
/login               → 邮箱密码登录
/register            → 邮箱密码注册
/auth/callback       → OAuth回调（接收token）
/dashboard           → 仪表盘（统计概览 + 配额）
/upload              → 文件上传（拖拽 + 进度 + 通知）
/files               → 文件管理（列表、复制链接、预览弹窗、删除）
/settings            → 个人设置（昵称、密码）
/admin               → 管理后台（用户管理、统计）
/f/[urlKey]          → 公开文件预览（SEO + OG元数据）
/d/[urlKey]          → 短链下载
```

### 上传交互设计

- **拖拽上传**：支持拖拽和点击选择文件
- **进度条**：小文件 XHR 真实进度（10% → 95% → 100%），大文件分片进度
- **完成通知**：右上角滑入弹窗，成功绿色/失败红色，3 秒自动消失
- **上传后复制链接**：上传完成后直接展示链接和复制按钮

### 文件管理交互

- **复制链接**：点击后按钮文字变为"已复制"，2 秒后自动恢复
- **页内预览**：点击预览弹出全屏遮罩弹窗，支持图片/视频/音频/PDF 在线查看
- **预览下载**：预览弹窗顶部工具栏提供下载按钮

## 后端 API 结构

```
/api/auth/*           → 认证（注册/登录/刷新/OAuth）
/api/users/*          → 用户信息 + 配额
/api/files/*          → 文件上传/管理（JWT鉴权）
/api/public/*         → 公开访问（无需认证）
/api/admin/*          → 管理后台（Admin角色）
```

## Docker 部署架构

生产环境使用 5 个容器编排部署：

```
              ┌──────────────────┐
              │  Nginx Proxy     │
              │  (SSL + 反向代理) │
              │  :80 / :443      │
              └────────┬─────────┘
                       │
              ┌────────┴─────────┐
              │                   │
       ┌──────┴──────┐    ┌──────┴──────┐
       │  Next.js    │    │  NestJS     │
       │  (前端)     │    │  (后端API)   │
       │  :3001      │    │  :3000      │
       └─────────────┘    └──────┬──────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
             ┌──────┴──────┐      ┌──────┴──────┐
             │ PostgreSQL  │      │   Redis     │
             │ :5432       │      │   :6379     │
             └─────────────┘      └─────────────┘
```

- 前端 Next.js 通过 `rewrites` 将 `/api/*` 代理到后端 NestJS（Docker 内部域名 `nestjs:3000`）
- 镜像托管在阿里云容器镜像服务（ACR）
- Nginx Proxy 通过 `VIRTUAL_HOST` 环境变量实现域名分流和 Let's Encrypt 自动 HTTPS

### 多环境配置

| 文件 | 用途 |
|------|------|
| `docker-compose.dev.yml` | 开发环境（仅 PostgreSQL + Redis） |
| `docker-compose.yml` | 完整本地部署（5 个容器 + Nginx） |
| `docker-compose.prod.yml` | 生产环境（ACR 镜像 + 共享 nginx-proxy） |

## 项目结构

```
cloud-storage/
├── client/                     # Next.js 前端
│   ├── src/
│   │   ├── app/               # App Router 页面
│   │   │   ├── (auth)/        # 登录注册布局组
│   │   │   ├── (dashboard)/   # 后台布局组
│   │   │   ├── f/[urlKey]/    # 文件公开预览
│   │   │   └── d/[urlKey]/    # 短链下载
│   │   ├── components/         # UI 组件
│   │   │   ├── preview/       # 预览组件（图片/视频/音频/PDF/代码）
│   │   │   ├── FileDropzone.tsx
│   │   │   ├── FileRow.tsx
│   │   │   ├── UploadProgress.tsx
│   │   │   └── Sidebar.tsx
│   │   ├── hooks/             # 自定义 Hooks（useUpload、useAuth）
│   │   ├── lib/               # 工具库（api.ts、upload.ts、auth.ts）
│   │   └── middleware.ts      # 路由保护中间件
│   ├── next.config.mjs
│   └── Dockerfile
│
├── server/                     # NestJS 后端
│   ├── src/
│   │   ├── auth/              # 认证模块（JWT + OAuth）
│   │   ├── users/             # 用户模块
│   │   ├── files/             # 文件管理模块
│   │   ├── public/            # 公开访问模块
│   │   ├── admin/             # 管理员模块
│   │   ├── s3/                # 七牛云 S3 服务
│   │   ├── prisma/            # Prisma 数据库服务
│   │   ├── redis/             # Redis 服务
│   │   └── common/            # 公共模块（配置/守卫/装饰器）
│   │       ├── config/         # Joi 环境变量验证
│   │       ├── guards/         # JWT / Admin 角色守卫
│   │       └── decorators/     # @CurrentUser / @Roles
│   ├── prisma/
│   │   └── schema.prisma      # 数据库 Schema
│   └── Dockerfile
│
├── docker-compose.yml          # 完整本地部署
├── docker-compose.dev.yml      # 开发环境
└── docker-compose.prod.yml     # 生产部署
```

## 在线体验

- **首页**: [kxpwty.cn](https://kxpwty.cn)
- **GitHub 仓库**: [CloudStore](https://github.com/KeXiongpeng/CloudStore)
