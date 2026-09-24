# API 接口文档

所有接口均带全局前缀 `/api`。除公开接口和管理说明中特别标注的情况外，认证接口需要在请求头携带：

```http
Authorization: Bearer <access_token>
```

## 通用响应约定

- 成功：`2xx`，返回 JSON。
- 参数错误：`400`
- 未认证：`401`
- 权限不足：`403`
- 资源不存在：`404`
- 邮箱已注册：`409`

---

## Auth / 认证

### POST `/api/auth/register`

注册用户。

**请求体**

```json
{
  "email": "demo@example.com",
  "password": "demo123456"
}
```

**成功响应**

```json
{
  "access_token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token",
  "user": {
    "id": "uuid",
    "email": "demo@example.com",
    "nickname": "demo",
    "role": "user",
    "tier": "free"
  }
}
```

---

### POST `/api/auth/login`

邮箱密码登录。

**请求体**

```json
{
  "email": "demo@example.com",
  "password": "demo123456"
}
```

**成功响应**

```json
{
  "access_token": "jwt-access-token",
  "refresh_token": "jwt-refresh-token",
  "user": {
    "id": "uuid",
    "email": "demo@example.com",
    "nickname": "Demo",
    "role": "user",
    "tier": "free"
  }
}
```

---

### POST `/api/auth/refresh`

使用 refresh token 换取新的 token。

**请求体**

```json
{
  "refresh_token": "jwt-refresh-token"
}
```

**成功响应**

```json
{
  "access_token": "new-access-token",
  "refresh_token": "new-refresh-token"
}
```

---

### POST `/api/auth/logout`

需要认证。

撤销 Redis 中保存的 refresh token。

**成功响应**

```json
{
  "message": "已成功登出"
}
```

---

### GET `/api/auth/providers`

公开接口。返回后端已配置的第三方登录方式。

**成功响应**

```json
{
  "providers": ["github", "google"]
}
```

如果微信开放平台凭证已配置，返回值会包含 `"wechat"`。

---

### GET `/api/auth/github`

公开接口。跳转 GitHub 授权页。

### GET `/api/auth/github/callback`

GitHub 授权回调。成功后重定向：

```text
/auth/callback?access_token=...&refresh_token=...
```

### GET `/api/auth/google`

公开接口。跳转 Google 授权页。

### GET `/api/auth/google/callback`

Google 授权回调。

### GET `/api/auth/wechat`

公开接口。跳转微信开放平台扫码授权页。

### GET `/api/auth/wechat/callback`

微信授权回调。

---

## Users / 当前用户

以下接口均需要认证。

### GET `/api/users/me`

返回当前用户信息。

### PATCH `/api/users/me`

更新当前用户资料。

**请求体**

```json
{
  "nickname": "新昵称"
}
```

### PATCH `/api/users/me/password`

修改密码。

**请求体**

```json
{
  "oldPassword": "old-password",
  "newPassword": "new-password"
}
```

### GET `/api/users/me/quota`

返回当前用户配额。

---

## Files / 文件管理

以下接口均需要认证。

### POST `/api/files/presign`

为 5MB 以内文件生成预签名直传地址。

**请求体**

```json
{
  "filename": "example.png",
  "contentType": "image/png",
  "fileSize": 1048576
}
```

### POST `/api/files/callback`

浏览器完成对象存储 PUT 后，由前端回调后端创建文件记录。

**请求体**

```json
{
  "filename": "example.png",
  "contentType": "image/png",
  "fileSize": 1048576,
  "storageKey": "uploads/uuid-example.png",
  "urlKey": "optional-random-key"
}
```

### POST `/api/files/upload-init`

初始化大文件分片上传。

**请求体**

```json
{
  "filename": "large-video.mp4",
  "contentType": "video/mp4",
  "totalSize": 524288000
}
```

### POST `/api/files/upload-part`

上传单个分片。

```http
POST /api/files/upload-part?uploadId=<uploadId>&partNumber=1
Content-Type: multipart/form-data
```

字段名为 `file`，单分片最大 `10MB`。

### POST `/api/files/upload-complete`

完成分片上传。

**请求体**

```json
{
  "uploadId": "multipart-upload-id",
  "filename": "large-video.mp4",
  "contentType": "video/mp4",
  "totalSize": 524288000,
  "parts": [
    {
      "partNumber": 1,
      "etag": "part-etag"
    }
  ]
}
```

### GET `/api/files`

分页获取当前用户文件。

**Query**

| 参数    | 默认 | 说明     |
| ------- | ---- | -------- |
| `page`  | `1`  | 页码     |
| `limit` | `20` | 每页数量 |

### GET `/api/files/stats`

返回当前用户文件统计。

### GET `/api/files/:id`

返回单个文件详情。

### DELETE `/api/files/:id`

删除指定文件。

---

## Public / 公开访问

以下接口不需要用户 JWT。

### GET `/api/public/files/:urlKey`

获取公开文件元信息、访问计数和临时预览 URL。

### GET `/api/public/files/:urlKey/content`

以流式响应返回文件内容，用于在线预览。

### POST `/api/public/files/:urlKey/view`

记录一次浏览。

### GET `/api/public/files/:urlKey/download`

记录一次下载，并重定向到预签名下载地址。

---

## Admin / 管理后台

以下接口需要管理员角色。

### GET `/api/admin/users`

分页获取用户列表。

**Query**

| 参数    | 默认 |
| ------- | ---- |
| `page`  | `1`  |
| `limit` | `20` |

### PATCH `/api/admin/users/:id`

更新用户角色或套餐。

**请求体**

```json
{
  "role": "user",
  "tier": "vip"
}
```

### DELETE `/api/admin/users/:id`

删除非管理员用户及其关联数据。当前实现为删除，不是软禁用。

### GET `/api/admin/stats`

返回平台用户、文件、存储、浏览和下载统计。

## 工作区 / RBAC API（v2 升级）

### 工作区

| 方法   | 路径                           | 权限               |
| ------ | ------------------------------ | ------------------ |
| POST   | `/api/workspaces`              | 登录用户           |
| GET    | `/api/workspaces`              | 登录用户           |
| GET    | `/api/workspaces/:workspaceId` | `workspace:view`   |
| PATCH  | `/api/workspaces/:workspaceId` | `workspace:update` |
| DELETE | `/api/workspaces/:workspaceId` | `workspace:delete` |

### 成员、邀请、审计

| 方法   | 路径                                             | 权限                 |
| ------ | ------------------------------------------------ | -------------------- |
| GET    | `/api/workspaces/:workspaceId/members`           | `member:read`        |
| PATCH  | `/api/workspaces/:workspaceId/members/:memberId` | `member:update_role` |
| DELETE | `/api/workspaces/:workspaceId/members/:memberId` | `member:remove`      |
| GET    | `/api/workspaces/:workspaceId/invitations`       | `member:read`        |
| POST   | `/api/workspaces/:workspaceId/invitations`       | `member:invite`      |
| POST   | `/api/invitations/accept`                        | 登录用户             |
| GET    | `/api/workspaces/:workspaceId/audit-logs`        | `audit:read`         |

### 工作区文件

| 方法   | 路径                                         | 权限          |
| ------ | -------------------------------------------- | ------------- |
| GET    | `/api/workspaces/:workspaceId/files`         | `file:view`   |
| GET    | `/api/workspaces/:workspaceId/files/stats`   | `file:view`   |
| GET    | `/api/workspaces/:workspaceId/files/:fileId` | `file:view`   |
| DELETE | `/api/workspaces/:workspaceId/files/:fileId` | `file:delete` |

邀请令牌是 64 位十六进制字符串，数据库只保存 SHA-256 哈希。邀请默认 7 天过期。

### 核心错误码

- `WORKSPACE_NOT_FOUND`
- `WORKSPACE_PERMISSION_DENIED`
- `WORKSPACE_MEMBER_INACTIVE`
- `WORKSPACE_MEMBER_NOT_FOUND`
- `WORKSPACE_OWNER_CANNOT_BE_REMOVED`
- `WORKSPACE_INVITATION_NOT_FOUND`
- `WORKSPACE_INVITATION_ALREADY_EXISTS`

## Workspace Upload API

All routes require JWT, workspace membership, and `file:upload`.

- `POST /api/workspaces/:workspaceId/upload/sessions` ? create session/instant detection.
- `POST /api/workspaces/:workspaceId/upload/sessions/:id/direct-url` ? direct PUT URL.
- `POST /api/workspaces/:workspaceId/upload/sessions/:id/chunk-urls` ? part PUT URLs.
- `POST /api/workspaces/:workspaceId/upload/sessions/:id/chunks/:chunkIndex/complete` ? confirm ETag.
- `POST /api/workspaces/:workspaceId/upload/sessions/:id/instant` ? confirm deduplicated upload.
- `POST /api/workspaces/:workspaceId/upload/sessions/:id/complete` ? merge/commit; idempotent after completion.
- `DELETE /api/workspaces/:workspaceId/upload/sessions/:id/cancel` ? abort and release reservation.
- `POST /api/workspaces/:workspaceId/folders/ensure` ? create nested folder path.

Key errors: `UPLOAD_SESSION_NOT_FOUND`, `UPLOAD_SESSION_EXPIRED`, `UPLOAD_SESSION_ALREADY_COMPLETED`, `UPLOAD_CHUNK_INVALID`, `UPLOAD_INSTANT_NOT_AVAILABLE`, `WORKSPACE_QUOTA_EXCEEDED`.
