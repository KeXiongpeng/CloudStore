# 数据库模型

Prisma Schema：[`server/prisma/schema.prisma`](../server/prisma/schema.prisma)

## ER 图

```mermaid
erDiagram
  User ||--o{ OAuthAccount : "拥有第三方账号"
  User ||--o{ File : "上传文件"
  User ||--o| UserQuota : "拥有配额"
  User ||--o{ ApiKey : "拥有 API Key"
  File ||--o{ AccessLog : "产生访问日志"

  User {
    string id PK
    string email UK
    string passwordHash "可空，OAuth 用户可为空"
    string nickname
    string avatarUrl
    enum role "user / admin"
    enum tier "free / vip"
    datetime createdAt
    datetime updatedAt
  }

  OAuthAccount {
    string id PK
    string userId FK
    enum provider "github / google / wechat"
    string providerId
    datetime createdAt
  }

  File {
    string id PK
    string userId FK
    string originalName
    string storageKey UK
    string urlKey UK
    bigint fileSize
    string mimeType
    bool isPrivate
    int viewCount
    int downloadCount
    string uploadIp
    datetime createdAt
    datetime deletedAt
  }

  UserQuota {
    string id PK
    string userId FK
    bigint storageLimit
    bigint storageUsed
    enum tier "free / vip"
    datetime updatedAt
  }

  ApiKey {
    string id PK
    string userId FK
    string name
    string keyHash
    datetime lastUsed
    datetime createdAt
  }

  AccessLog {
    string id PK
    string fileId FK
    string ip
    enum action "view / download"
    datetime accessedAt
  }
```

## 关键约束

| 表 / 字段 | 说明 |
| --- | --- |
| `users.email` | 唯一；本地邮箱登录依赖此字段 |
| `users.password_hash` | OAuth 创建的用户初始为空 |
| `oauth_accounts(provider, provider_id)` | 联合唯一，防止同一第三方身份重复绑定 |
| `files.storage_key` | 对象存储 Key，唯一 |
| `files.url_key` | 分享路径标识，唯一 |
| `files.deleted_at` | 软删除标记 |
| `user_quotas.user_id` | 唯一，一对一 |
| `access_logs.file_id` | 删除用户时会级联删除访问日志 |

## 枚举

### Role

- `user`
- `admin`

### Tier

- `free`：默认免费套餐
- `vip`：管理后台可调整

### OAuthProvider

- `github`
- `google`
- `wechat`

### AccessAction

- `view`
- `download`

## 默认配额

| 套餐 | 存储上限 |
| --- | --- |
| Free | 500 MB |
| VIP | 10 GB |
