# 架构说明

## 技术架构

```mermaid
flowchart TB
  subgraph Client["浏览器"]
    UI["Next.js App Router UI"]
  end

  subgraph Edge["入口层"]
    Proxy["Nginx / 生产 Nginx Proxy"]
  end

  subgraph App["应用层"]
    Next["Next.js 14<br/>SSR / RSC / 静态资源"]
    Nest["NestJS API"]
  end

  subgraph Data["数据与存储层"]
    PG[(PostgreSQL)]
    Redis[(Redis)]
    S3[(S3 兼容对象存储)]
  end

  UI --> Proxy
  Proxy --> Next
  Proxy --> Nest
  Next -->|"/api 反向代理"| Nest
  Next -->|"预签名 PUT 直传"| S3
  Nest --> PG
  Nest --> Redis
  Nest --> S3
```

## 模块职责

| 模块                    | 职责                                             |
| ----------------------- | ------------------------------------------------ |
| `client/src/app`        | 页面路由、服务端渲染、公开预览、认证页、后台页面 |
| `client/src/lib/api.ts` | Axios 实例、JWT 请求头、401 自动刷新             |
| `server/src/auth`       | 注册、登录、刷新令牌、OAuth、JWT 签发            |
| `server/src/users`      | 当前用户、昵称、密码、配额查询                   |
| `server/src/files`      | 预签名上传、分片上传、文件列表、删除、统计       |
| `server/src/public`     | 公开文件元信息、内容流、浏览 / 下载统计          |
| `server/src/admin`      | 用户管理、套餐调整、平台统计                     |
| `server/prisma`         | 数据模型、迁移、seed                             |

## 认证流程

```mermaid
sequenceDiagram
  participant B as Browser
  participant N as Next.js
  participant A as NestJS Auth
  participant R as Redis

  B->>N: POST /api/auth/login
  N->>A: 转发请求
  A->>A: 校验 bcrypt 密码
  A->>R: 保存 refresh token
  A-->>N: access_token / refresh_token / user
  N-->>B: 登录成功
  B->>N: 携带 access token 请求业务接口
  N->>A: 校验 JWT
```

## OAuth 流程

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as NestJS
  participant P as GitHub / Google / WeChat

  B->>A: GET /api/auth/{provider}
  A->>A: 生成 state 并写入 HttpOnly Cookie
  A-->>B: 302 到第三方授权页
  B->>P: 用户授权
  P-->>B: redirect_uri?code&state
  B->>A: GET /api/auth/{provider}/callback
  A->>A: 校验 state
  A->>P: code 换 access token
  A->>P: 拉取用户信息
  A->>A: 创建或绑定本地用户
  A-->>B: 重定向 /auth/callback?access_token&refresh_token
```

## 小文件上传流程

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as NestJS
  participant S as S3 存储

  B->>A: POST /api/files/presign
  A->>A: 校验 JWT 与配额
  A->>S: 生成预签名 PUT URL
  A-->>B: 返回 storageKey / uploadUrl
  B->>S: PUT 文件
  B->>A: POST /api/files/callback
  A->>A: 创建 File 与扣减配额
```

## 大文件分片上传流程

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as NestJS
  participant S as S3 存储

  B->>A: POST /api/files/upload-init
  A->>S: CreateMultipartUpload
  B->>A: POST /api/files/upload-part?uploadId&partNumber
  A->>S: UploadPart
  loop 所有分片
    B->>S: 按预签名或后端代理上传分片
  end
  B->>A: POST /api/files/upload-complete
  A->>S: CompleteMultipartUpload
  A->>A: 落库并更新配额
```

## 公开访问流程

1. 访问 `/f/:urlKey`。
2. 前端请求 `GET /api/public/files/:urlKey`。
3. 后端校验文件未删除且非私有，返回元信息和临时预览 URL。
4. 前端根据 MIME 类型渲染预览器。
5. 用户访问下载地址时，后端记录下载日志并重定向到预签名下载 URL。
