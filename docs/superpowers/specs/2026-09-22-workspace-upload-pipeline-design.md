# CloudDrive v2：工作区权限与上传流水线设计

- 日期：2026-09-22
- 状态：Approved
- 范围：第 2 阶段 Workspace/RBAC/数据隔离/审计日志；第 3 阶段企业级上传流水线
- 不在范围：分享安全、全文搜索、版本管理后台、回收站完整产品化、Kubernetes

## 1. 背景与目标

当前系统是个人网盘模型：

- `File.user_id` 直接归属用户；
- 没有工作区、成员、工作区角色、权限矩阵、审计日志；
- `UserQuota` 只作用于个人；
- 分片上传状态保存在 Redis，进程重启或 Redis 过期后不可恢复；
- 没有持久化上传会话、分片清单、秒传索引和异步任务；
- 前端上传逻辑没有断点续传、完整队列状态和权限驱动 UI。

本次升级目标：

1. 将系统升级为多租户团队系统，用户可创建和加入多个 Workspace。
2. 后端强制执行角色与权限校验，所有敏感操作产生审计日志。
3. 上传流程支持小文件直传、大文件分片、断点续传、秒传、去重、失败重试、并发控制、会话过期、配额控制和异步缩略图。
4. 保持既有公开文件 `urlKey` 可访问，降低生产迁移风险。

## 2. 总体架构

### 2.1 架构原则

- Workspace 是所有业务数据的租户边界。
- 后端是权限与数据隔离的唯一可信边界；前端权限只控制交互展示。
- 新模块不直接横向依赖：`workspace`、`upload`、`storage`、`audit`、`queue` 之间通过 Service 接口和领域事件协作。
- 上传接口保持幂等：客户端上传 ID、分片索引、文件哈希共同消除重复副作用。
- 配额先预留、成功后转正式占用、失败/取消/过期后释放。
- 数据库保存不可丢失状态，Redis 只保存可重建缓存、并发锁和短期节流状态。

### 2.2 新模块边界

```text
apps 后续可演进为 monorepo；当前保持 client/ + server/。

server/src/workspaces
  Workspace、成员、邀请、角色、权限、成员列表、权限变更

server/src/audit
  审计日志写入、查询、审计上下文

server/src/upload
  上传会话、分片状态、秒传查询、合并、重试、过期清理

server/src/storage
  S3/MinIO/七牛适配器、预签名、对象存在性、对象生命周期

server/src/quota
  配额查询、预留、确认、释放、事务校验

server/src/queue
  BullMQ 生产者/消费者注册、任务幂等、重试策略

server/src/thumbnails
  图片/视频封面/PDF 封面等异步缩略图任务

client/src/features/workspace
  工作区切换、成员、邀请、权限展示

client/src/features/upload
  上传队列、分片调度、重试、拖拽、文件夹上传、进度展示
```

禁止反向依赖：

- `workspace` 不依赖 `upload`；
- `upload` 不直接依赖具体云厂商 SDK；
- `audit` 只提供记录与查询能力，不反向调用业务模块；
- `quota` 不直接操作对象存储；
- 业务模块通过领域事件或显式 Service 调用协作。

## 3. 角色与权限模型

### 3.1 角色

使用固定系统角色，第一阶段不实现自定义角色：

| 角色     | 定位                                             |
| -------- | ------------------------------------------------ |
| `OWNER`  | 工作区创建者，可删除工作区、转让所有权           |
| `ADMIN`  | 管理成员、权限、配额、审计日志                   |
| `EDITOR` | 查看、上传、下载、重命名、删除自己或被授权内容   |
| `VIEWER` | 查看、下载                                       |
| `GUEST`  | 临时受限访问，默认仅查看指定资源，本次仅预留模型 |

### 3.2 权限点

| 权限                 | OWNER | ADMIN | EDITOR | VIEWER | GUEST |
| -------------------- | ----- | ----- | ------ | ------ | ----- |
| `workspace:view`     | ✅    | ✅    | ✅     | ✅     | ✅    |
| `workspace:update`   | ✅    | ✅    | ❌     | ❌     | ❌    |
| `workspace:delete`   | ✅    | ❌    | ❌     | ❌     | ❌    |
| `member:read`        | ✅    | ✅    | ❌     | ❌     | ❌    |
| `member:invite`      | ✅    | ✅    | ❌     | ❌     | ❌    |
| `member:update_role` | ✅    | ✅    | ❌     | ❌     | ❌    |
| `member:remove`      | ✅    | ✅    | ❌     | ❌     | ❌    |
| `audit:read`         | ✅    | ✅    | ❌     | ❌     | ❌    |
| `file:view`          | ✅    | ✅    | ✅     | ✅     | ✅    |
| `file:upload`        | ✅    | ✅    | ✅     | ❌     | ❌    |
| `file:download`      | ✅    | ✅    | ✅     | ✅     | ✅    |
| `file:update`        | ✅    | ✅    | ✅     | ❌     | ❌    |
| `file:delete`        | ✅    | ✅    | ✅     | ❌     | ❌    |
| `quota:read`         | ✅    | ✅    | ✅     | ✅     | ✅    |
| `quota:update`       | ✅    | ✅    | ❌     | ❌     | ❌    |

约束：

- 只有 `OWNER` 能删除工作区或转让 `OWNER`。
- `ADMIN` 不能修改或移除 `OWNER`。
- 权限矩阵代码化为单一常量来源，Guard 与前端共享字段名，但不共享后端私有实现。
- 所有后端接口必须先通过 `WorkspaceGuard` 解析当前 `workspaceId` 与成员身份，再通过 `PermissionGuard` 校验权限点。

## 4. 数据模型

### 4.1 新增核心表

#### workspaces

| 字段                        | 类型               | 说明                                      |
| --------------------------- | ------------------ | ----------------------------------------- |
| `id`                        | uuid PK            | 工作区 ID                                 |
| `name`                      | varchar(128)       | 名称                                      |
| `slug`                      | varchar(64) unique | URL 标识                                  |
| `owner_id`                  | uuid FK users      | 所有者                                    |
| `storage_driver`            | varchar(32)        | 本地默认 `minio`，生产可为 `qiniu` / `s3` |
| `status`                    | enum               | `active` / `suspended`                    |
| `created_at` / `updated_at` | timestamp          | 通用时间字段                              |

#### workspace_members

| 字段           | 类型      | 说明                                              |
| -------------- | --------- | ------------------------------------------------- |
| `id`           | uuid PK   | 成员记录 ID                                       |
| `workspace_id` | uuid FK   | 工作区                                            |
| `user_id`      | uuid FK   | 用户                                              |
| `role`         | enum      | `OWNER` / `ADMIN` / `EDITOR` / `VIEWER` / `GUEST` |
| `status`       | enum      | `active` / `disabled`                             |
| `joined_at`    | timestamp | 加入时间                                          |
| `updated_at`   | timestamp | 更新时间                                          |

唯一索引：`unique(workspace_id, user_id)`。

#### workspace_invitations

| 字段           | 类型                | 说明                                           |
| -------------- | ------------------- | ---------------------------------------------- |
| `id`           | uuid PK             | 邀请 ID                                        |
| `workspace_id` | uuid FK             | 工作区                                         |
| `email`        | varchar(254)        | 被邀请邮箱                                     |
| `role`         | enum                | 授予角色                                       |
| `token_hash`   | varchar(128) unique | 邀请令牌哈希                                   |
| `invited_by`   | uuid FK users       | 邀请人                                         |
| `status`       | enum                | `pending` / `accepted` / `revoked` / `expired` |
| `expires_at`   | timestamp           | 过期时间                                       |
| `accepted_at`  | timestamp nullable  | 接受时间                                       |

#### permissions / role_permissions

第一阶段角色权限写入代码常量，数据库表仅作为后续自定义角色扩展位；本次不提供自定义角色 UI。

#### audit_logs

| 字段            | 类型                   | 说明                                       |
| --------------- | ---------------------- | ------------------------------------------ |
| `id`            | bigint/uuid PK         | 日志 ID                                    |
| `workspace_id`  | uuid nullable FK       | 工作区上下文                               |
| `actor_id`      | uuid nullable FK users | 操作者                                     |
| `action`        | varchar(64)            | 如 `member.invited`、`file.uploaded`       |
| `resource_type` | varchar(32)            | `workspace` / `member` / `file` / `upload` |
| `resource_id`   | varchar(64)            | 资源 ID                                    |
| `ip`            | varchar(64)            | 来源 IP                                    |
| `user_agent`    | varchar(512)           | UA                                         |
| `request_id`    | varchar(64)            | 请求追踪 ID                                |
| `before`        | jsonb nullable         | 变更前                                     |
| `after`         | jsonb nullable         | 变更后                                     |
| `created_at`    | timestamp              | 时间                                       |

索引：`index(workspace_id, created_at)`、`index(workspace_id, actor_id, created_at)`。

### 4.2 文件与上传相关表

#### folders

本次引入逻辑文件夹，用于文件夹上传和后续文件树。

| 字段                        | 类型                  | 说明                       |
| --------------------------- | --------------------- | -------------------------- |
| `id`                        | uuid PK               | 文件夹 ID                  |
| `workspace_id`              | uuid FK               | 工作区                     |
| `parent_id`                 | uuid nullable self FK | 父文件夹                   |
| `name`                      | varchar(255)          | 名称                       |
| `path`                      | varchar(1024)         | 规范化路径，用于去重和查询 |
| `created_by`                | uuid FK users         | 创建人                     |
| `created_at` / `updated_at` | timestamp             | 通用字段                   |

唯一索引：`unique(workspace_id, parent_id, name)`。

#### files

将现有个人文件模型演进为工作区模型：

| 字段                        | 类型               | 说明                   |
| --------------------------- | ------------------ | ---------------------- |
| `id`                        | uuid PK            | 文件 ID                |
| `workspace_id`              | uuid FK            | 租户 ID                |
| `folder_id`                 | uuid nullable FK   | 所在文件夹             |
| `created_by` / `updated_by` | uuid FK users      | 业务归属人             |
| `name`                      | varchar(255)       | 当前文件名             |
| `mime_type`                 | varchar(255)       | MIME                   |
| `extension`                 | varchar(32)        | 扩展名                 |
| `size`                      | bigint             | 当前版本大小           |
| `hash`                      | varchar(128)       | 当前版本内容哈希       |
| `hash_algorithm`            | varchar(16)        | 默认 `sha256`          |
| `current_version_id`        | uuid nullable      | 当前版本               |
| `url_key`                   | varchar(64) unique | 保留旧公开访问兼容字段 |
| `visibility`                | enum               | `private` / `public`   |
| `deleted_at`                | timestamp nullable | 软删除                 |
| `created_at` / `updated_at` | timestamp          | 通用字段               |

约束：

- 同一文件夹内 `name` 可保留旧文件，新上传默认生成新文件；覆盖策略后续在版本管理阶段明确。
- 当前阶段保留旧 `is_private` 映射到 `visibility`。
- 所有工作区列表查询必须带 `workspace_id` 和 `deletedAt: null`。

#### file_versions

| 字段               | 类型                   | 说明                                                  |
| ------------------ | ---------------------- | ----------------------------------------------------- |
| `id`               | uuid PK                | 版本 ID                                               |
| `file_id`          | uuid FK                | 文件                                                  |
| `version_no`       | int                    | 从 1 递增                                             |
| `storage_key`      | varchar(1024)          | 对象存储 key                                          |
| `size`             | bigint                 | 字节数                                                |
| `hash`             | varchar(128)           | 内容哈希                                              |
| `hash_algorithm`   | varchar(16)            | 默认 `sha256`                                         |
| `mime_type`        | varchar(255)           | MIME                                                  |
| `metadata`         | jsonb nullable         | 元数据                                                |
| `thumbnail_key`    | varchar(1024) nullable | 缩略图对象 key                                        |
| `thumbnail_status` | enum                   | `none` / `pending` / `processing` / `done` / `failed` |
| `created_by`       | uuid FK users          | 上传人                                                |
| `created_at`       | timestamp              | 时间                                                  |

唯一索引：`unique(file_id, version_no)`。

#### upload_sessions

| 字段                        | 类型                   | 说明                                                                                  |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------- |
| `id`                        | uuid PK                | 客户端与后端共用的上传 ID                                                             |
| `client_upload_id`          | varchar(64) unique     | 客户端幂等 ID                                                                         |
| `workspace_id`              | uuid FK                | 工作区                                                                                |
| `folder_id`                 | uuid nullable FK       | 目标文件夹                                                                            |
| `created_by`                | uuid FK users          | 上传人                                                                                |
| `filename`                  | varchar(255)           | 文件名                                                                                |
| `mime_type`                 | varchar(255)           | MIME                                                                                  |
| `size`                      | bigint                 | 总大小                                                                                |
| `hash`                      | varchar(128) nullable  | 客户端提供或完成时校验                                                                |
| `hash_algorithm`            | varchar(16)            | 默认 `sha256`                                                                         |
| `chunk_size`                | int                    | 分片大小                                                                              |
| `total_chunks`              | int                    | 分片总数                                                                              |
| `uploaded_chunks`           | int                    | 成功分片数                                                                            |
| `mode`                      | enum                   | `direct` / `multipart`                                                                |
| `strategy`                  | enum                   | `normal` / `instant`                                                                  |
| `status`                    | enum                   | `pending` / `uploading` / `merging` / `completed` / `failed` / `canceled` / `expired` |
| `storage_key`               | varchar(1024)          | 目标对象 key                                                                          |
| `provider_upload_id`        | varchar(255) nullable  | S3 multipart upload ID                                                                |
| `quota_reserved`            | bigint                 | 预留配额                                                                              |
| `expires_at`                | timestamp              | 过期时间                                                                              |
| `completed_at`              | timestamp nullable     | 完成时间                                                                              |
| `failure_reason`            | varchar(1024) nullable | 失败原因                                                                              |
| `created_at` / `updated_at` | timestamp              | 通用字段                                                                              |

#### upload_chunks

| 字段                | 类型                  | 说明                              |
| ------------------- | --------------------- | --------------------------------- |
| `id`                | uuid PK               | 分片 ID                           |
| `upload_session_id` | uuid FK               | 所属上传会话                      |
| `chunk_index`       | int                   | 从 1 开始                         |
| `size`              | bigint                | 分片大小                          |
| `etag`              | varchar(255) nullable | S3 ETag                           |
| `status`            | enum                  | `pending` / `uploaded` / `failed` |
| `attempt_count`     | int                   | 尝试次数                          |
| `uploaded_at`       | timestamp nullable    | 成功时间                          |

唯一索引：`unique(upload_session_id, chunk_index)`。

#### storage_objects

去重对象元数据表，支持秒传和多文件引用同一物理对象。

| 字段              | 类型          | 说明                                       |
| ----------------- | ------------- | ------------------------------------------ |
| `id`              | uuid PK       | 对象记录 ID                                |
| `hash_algorithm`  | varchar(16)   | 默认 `sha256`                              |
| `hash`            | varchar(128)  | 内容哈希                                   |
| `size`            | bigint        | 字节数                                     |
| `storage_driver`  | varchar(32)   | 存储驱动                                   |
| `storage_key`     | varchar(1024) | 物理 key                                   |
| `reference_count` | int           | 引用计数                                   |
| `status`          | enum          | `available` / `pending_delete` / `deleted` |
| `created_at`      | timestamp     | 时间                                       |
| `updated_at`      | timestamp     | 时间                                       |

唯一索引：`unique(storage_driver, hash_algorithm, hash)`。

#### quotas

使用工作区配额为主，用户配额可后续扩展：

| 字段             | 类型           | 说明       |
| ---------------- | -------------- | ---------- |
| `id`             | uuid PK        | 配额 ID    |
| `workspace_id`   | uuid unique FK | 工作区     |
| `total_size`     | bigint         | 总容量     |
| `used_size`      | bigint         | 正式占用   |
| `reserved_size`  | bigint         | 上传中预留 |
| `max_file_size`  | bigint         | 单文件上限 |
| `max_file_count` | int            | 文件数上限 |
| `updated_at`     | timestamp      | 更新时间   |

约束：`used_size + reserved_size <= total_size` 由服务层事务校验，并在关键路径使用行级锁或条件更新防止并发超额。

## 5. 上传流水线

### 5.1 上传参数与阈值

- 默认分片：`8 MB`，取值范围 `5 MB` 到 `16 MB`。
- 小文件阈值：`<= 8 MB` 使用直传。
- 直传也创建 `upload_sessions`，保证取消、重试、失败和配额释放语义一致。
- 客户端在创建会话前计算 SHA-256，用于秒传和完成校验。
- 文件夹上传时客户端按 `webkitRelativePath` 逐级创建文件夹并回填 `folderId`。

### 5.2 创建上传会话

```http
POST /api/workspaces/:workspaceId/upload/sessions
```

流程：

1. `WorkspaceGuard` 确认当前用户是 active 成员。
2. `PermissionGuard` 校验 `file:upload`。
3. 校验文件类型、文件名、MIME、总大小、分片数量。
4. 开启数据库事务并锁定工作区配额。
5. 判断 `used_size + reserved_size + size <= total_size`。
6. 创建 `upload_session`，状态 `pending`，增加 `reserved_size`。
7. 按 `hash + size` 查询 `storage_objects`：
   - 命中且 `status=available`，标记 `strategy=instant`，状态 `merging`，进入秒传确认；
   - 未命中，创建分片记录，并根据大小返回 direct 或 multipart 参数。
8. 事务提交后写入 `upload.created` 审计日志。

响应：

```json
{
  "uploadSessionId": "uuid",
  "clientUploadId": "uuid",
  "mode": "direct | multipart",
  "strategy": "normal | instant",
  "chunkSize": 8388608,
  "totalChunks": 12,
  "uploadedChunks": [],
  "expiresAt": "ISO8601"
}
```

### 5.3 秒传

秒传确认：

```http
POST /api/workspaces/:workspaceId/upload/sessions/:uploadSessionId/instant
```

流程：

1. 校验会话属于当前用户和工作区。
2. 校验会话 `strategy=instant` 且未过期。
3. 事务中：
   - `storage_objects.reference_count += 1`；
   - 创建 `file`；
   - 创建 `file_versions`，版本号 1；
   - 更新 `files.hash/current_version_id/size`；
   - 配额 `reserved_size -= size`，`used_size += size`；
   - 会话状态 `completed`。
4. 触发缩略图与元数据任务。
5. 写入 `file.instant_uploaded` 审计日志。

安全规则：

- 秒传结果不可读取未授权内容，只创建指向同一物理对象的引用。
- 用户声明的哈希必须与服务端 `storage_objects` 哈希完全一致。
- 下载和预览最终仍走工作区权限校验。
- 若怀疑哈希碰撞，可配置强制读回抽样校验，但默认不下载整对象。

### 5.4 直传

```http
POST /api/workspaces/:workspaceId/upload/sessions/:uploadSessionId/direct-url
```

返回短时效 PUT URL。客户端上传后调用确认：

```http
POST /api/workspaces/:workspaceId/upload/sessions/:uploadSessionId/complete
```

后端完成：

1. HeadObject 校验对象存在。
2. 校验对象大小与声明一致。
3. 创建 `storage_objects` 或增加引用。
4. 创建 `file` 和 `file_versions`。
5. 更新配额。
6. 完成会话。
7. 入队缩略图任务。
8. 写审计日志。

### 5.5 分片上传

获取分片预签名 URL：

```http
POST /api/workspaces/:workspaceId/upload/sessions/:uploadSessionId/chunk-urls
```

请求：

```json
{ "chunkIndexes": [1, 2, 3, 4, 5, 6] }
```

响应中每个分片有独立 PUT URL 和过期时间。

客户端上传成功后确认：

```http
POST /api/workspaces/:workspaceId/upload/sessions/:uploadSessionId/chunks/:chunkIndex/complete
```

后端：

1. 校验会话、分片、用户、工作区。
2. 记录 ETag、大小、状态 `uploaded`、`uploaded_at`。
3. 递增会话 `uploaded_chunks`。
4. 幂等处理重复确认，不重复计数。

恢复上传：

```http
GET /api/workspaces/:workspaceId/upload/sessions/:uploadSessionId
```

返回已上传分片、缺失分片、过期时间和会话状态。客户端只补传缺失分片。

合并：

```http
POST /api/workspaces/:workspaceId/upload/sessions/:uploadSessionId/complete
```

后端：

1. 校验所有分片状态为 `uploaded`。
2. 使用 Redis 分布式锁防止重复合并。
3. 调用 S3 CompleteMultipartUpload。
4. 校验对象大小。
5. 计算或读取服务端 SHA-256；若 provider 不支持流式校验，则异步校验并在任务失败时标记文件异常。
6. 创建 `storage_objects`、`file`、`file_versions`。
7. 配额由预留转为正式占用。
8. 更新会话为 `completed`。
9. 入队缩略图任务。
10. 写审计日志。

### 5.6 并发、重试和过期

- 客户端默认同文件顺序分片，不同文件最多 3 个并行上传。
- 每个分片失败自动重试 3 次，采用指数退避：1s、2s、4s。
- 会话默认 24 小时过期。
- 定时任务扫描 `expires_at < now()` 且状态为 `pending/uploading` 的会话：
  - 标记 `expired`；
  - 释放预留配额；
  - 取消 S3 multipart upload；
  - 保留记录供排查；
  - 对引用为 0 的临时对象延迟清理。
- 客户端可主动取消会话，服务端释放配额并写审计日志。
- 合并接口必须幂等：重复调用返回已完成文件结果，不再创建版本。

### 5.7 缩略图异步任务

- BullMQ 队列：`file-thumbnail`。
- 任务参数：`fileVersionId`、`storageKey`、`mimeType`、`workspaceId`。
- 首期支持：
  - 图片：生成 WebP 缩略图；
  - PDF：生成首页封面；
  - 视频封面与 Office 预览后置。
- 消费者更新 `file_versions.thumbnail_status`。
- 重试 5 次，指数退避。
- 最终失败标记 `failed`，不阻塞上传完成。
- 本地 Docker 增加 worker 服务；生产 worker 可与 API 同镜像但启动不同命令。

## 6. API 契约

统一前缀：`/api`。

### Workspace

| 方法     | 路径                                         | 权限                 |
| -------- | -------------------------------------------- | -------------------- |
| `POST`   | `/workspaces`                                | 登录用户             |
| `GET`    | `/workspaces`                                | 登录用户             |
| `GET`    | `/workspaces/:workspaceId`                   | `workspace:view`     |
| `PATCH`  | `/workspaces/:workspaceId`                   | `workspace:update`   |
| `DELETE` | `/workspaces/:workspaceId`                   | `workspace:delete`   |
| `GET`    | `/workspaces/:workspaceId/members`           | `member:read`        |
| `PATCH`  | `/workspaces/:workspaceId/members/:memberId` | `member:update_role` |
| `DELETE` | `/workspaces/:workspaceId/members/:memberId` | `member:remove`      |
| `POST`   | `/workspaces/:workspaceId/invitations`       | `member:invite`      |
| `GET`    | `/workspaces/:workspaceId/invitations`       | `member:read`        |
| `POST`   | `/invitations/accept`                        | 登录用户             |
| `GET`    | `/workspaces/:workspaceId/audit-logs`        | `audit:read`         |

### Upload

| 方法     | 路径                                           | 权限                       |
| -------- | ---------------------------------------------- | -------------------------- |
| `POST`   | `/workspaces/:workspaceId/upload/sessions`     | `file:upload`              |
| `GET`    | `/workspaces/:workspaceId/upload/sessions/:id` | 会话创建人或 `file:view`   |
| `POST`   | `.../direct-url`                               | `file:upload`              |
| `POST`   | `.../chunk-urls`                               | `file:upload`              |
| `POST`   | `.../chunks/:chunkIndex/complete`              | `file:upload`              |
| `POST`   | `.../complete`                                 | `file:upload`              |
| `POST`   | `.../instant`                                  | `file:upload`              |
| `DELETE` | `.../cancel`                                   | 会话创建人或 `file:delete` |
| `GET`    | `/workspaces/:workspaceId/files`               | `file:view`                |
| `GET`    | `/workspaces/:workspaceId/files/:fileId`       | `file:view`                |
| `DELETE` | `/workspaces/:workspaceId/files/:fileId`       | `file:delete`              |

### 统一响应

成功：

```json
{
  "success": true,
  "code": "OK",
  "message": "ok",
  "data": {},
  "requestId": "uuid"
}
```

失败：

```json
{
  "success": false,
  "code": "WORKSPACE_PERMISSION_DENIED",
  "message": "没有执行该操作的权限",
  "details": [],
  "requestId": "uuid"
}
```

核心错误码：

| HTTP | code                               | 场景                 |
| ---- | ---------------------------------- | -------------------- |
| 400  | `VALIDATION_ERROR`                 | DTO 校验失败         |
| 401  | `UNAUTHENTICATED`                  | 未登录               |
| 403  | `WORKSPACE_PERMISSION_DENIED`      | 无权限点             |
| 403  | `WORKSPACE_MEMBER_INACTIVE`        | 成员被禁用           |
| 404  | `WORKSPACE_NOT_FOUND`              | 工作区不存在或不可见 |
| 404  | `UPLOAD_SESSION_NOT_FOUND`         | 会话不存在           |
| 409  | `UPLOAD_SESSION_ALREADY_COMPLETED` | 重复完成             |
| 409  | `UPLOAD_CHUNK_INVALID`             | 分片状态错误         |
| 410  | `UPLOAD_SESSION_EXPIRED`           | 会话过期             |
| 413  | `FILE_TOO_LARGE`                   | 超过单文件或配额限制 |
| 413  | `WORKSPACE_QUOTA_EXCEEDED`         | 空间不足             |
| 415  | `FILE_TYPE_NOT_ALLOWED`            | 类型禁止             |
| 429  | `UPLOAD_RATE_LIMITED`              | 上传频率受限         |
| 500  | `INTERNAL_ERROR`                   | 服务端异常           |

## 7. 前端设计

### 7.1 技术引入

新增：

- Zustand：全局当前工作区与上传队列状态；
- TanStack Query：工作区、成员、文件列表和服务端状态；
- React Hook Form + Zod：邀请表单、工作区表单；
- `react-dropzone` 或原生 drag-and-drop：拖拽上传；
- `@tanstack/react-virtual`：文件大列表虚拟滚动；
- Tailwind dark mode：暗色模式。

不引入 Ant Design，除非用户明确要求；当前项目已使用 Tailwind，先保持轻量。

### 7.2 页面与交互

| 路由                                    | 能力                                   |
| --------------------------------------- | -------------------------------------- |
| `/dashboard`                            | 工作区概览、配额、最近文件             |
| `/files`                                | 当前工作区文件列表、虚拟滚动、上传入口 |
| `/workspaces/new`                       | 创建工作区                             |
| `/workspaces/[workspaceId]/members`     | 成员列表、角色修改、移除               |
| `/workspaces/[workspaceId]/invitations` | 邀请成员、撤销邀请                     |
| `/invitations/accept`                   | 登录用户接受邀请                       |
| `/admin/audit`                          | 管理员查看审计日志                     |

### 7.3 上传队列

Zustand 队列项状态：

```ts
type UploadItemStatus =
  | 'hashing'
  | 'creating'
  | 'instant'
  | 'uploading'
  | 'merging'
  | 'completed'
  | 'canceled'
  | 'failed';

interface UploadItem {
  id: string;
  file: File;
  relativePath?: string;
  workspaceId: string;
  folderId?: string;
  status: UploadItemStatus;
  progress: number;
  uploadedBytes: number;
  hash?: string;
  uploadSessionId?: string;
  missingChunks?: number[];
  error?: string;
  attempt: number;
}
```

能力：

- 拖拽文件和文件夹；
- 上传前 SHA-256；
- 秒传展示；
- 分片并发与失败重试；
- 页面刷新后通过会话恢复；
- 队列持久化仅保存可恢复元信息，不把 File 写入 localStorage；
- 权限不足时禁用按钮并显示原因；
- 上传完成使用 TanStack Query 局部失效更新文件列表。

## 8. 审计日志

### 8.1 必须记录

- 工作区创建、更新、删除；
- 成员邀请、接受、角色变更、移除；
- 文件上传、秒传、取消、删除；
- 上传会话过期由定时任务记录；
- 配额预留异常和配额更新；
- 权限拒绝不强制记录，但可疑高频拒绝可后续接入风控。

### 8.2 实现方式

- `AuditService.record(...)`；
- 敏感数据库事务提交后再异步落库，避免业务事务被日志失败阻断；
- 审计失败记录应用日志和重试任务；
- 日志查询只允许 `ADMIN` / `OWNER`；
- 查询支持时间、actor、action、resource_type 分页过滤。

## 9. 规范与工程约束

### 9.1 代码规范

- TypeScript strict mode。
- 后端命名：Controller 只做协议适配，Service 承载业务，Repository/Prisma 访问封装在模块内。
- 前端组件不直接写 Axios；统一通过 `lib/api` 和 feature hooks。
- 每个功能目录遵循：

```text
feature/
  controller.ts
  service.ts
  dto/
  guards/
  interfaces/
  feature.module.ts
```

### 9.2 依赖图谱规则

模块依赖方向：

```text
app.module
  -> auth
  -> users
  -> workspaces
  -> files
  -> upload
  -> storage
  -> quota
  -> audit
  -> queue

upload -> workspaces(permission service) -> users
upload -> quota
upload -> storage
upload -> queue
files -> workspaces(permission service)
queue -> thumbnails
```

落地方式：

- ESLint `no-restricted-imports` 约束跨模块私有路径导入；
- 禁止导入其他模块的 `*.internal.ts`；
- 公共契约放入 `contracts/` 或模块 `interfaces/public-api.ts`；
- Prettier + ESLint + TypeScript build 作为 CI 阻断检查；
- Husky 提交前执行受影响包 lint。

### 9.3 Git 与提交

- 当前分支 `ui-docs-oauth-upgrade` 先合入或确认后再开新分支。
- 本次开发分支建议：`feat/workspace-upload-pipeline`。
- 提交类型：
  - `feat(workspace): ...`
  - `feat(upload): ...`
  - `test(upload): ...`
  - `docs(spec): ...`
- 禁止在功能分支提交 `.env`、`.env.production`、真实密钥。

## 10. 本地开发与测试

### 10.1 本地依赖

Docker Compose 提供：

- PostgreSQL：`5433 -> 5432`
- Redis：`6380 -> 6379`
- MinIO：`9000 API / 9001 Console`
- worker 与 API 在开发命令中启动

`.env.example` 新增：

```env
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=http://localhost:9000
MINIO_BUCKET=clouddrive-local
STORAGE_DRIVER=minio
UPLOAD_SESSION_TTL_HOURS=24
UPLOAD_CHUNK_SIZE_MB=8
MAX_CONCURRENT_UPLOADS=3
THUMBNAIL_MAX_RETRIES=5
```

### 10.2 测试策略

单元测试：

- 权限矩阵；
- 配额预留/确认/释放；
- 分片状态机；
- 秒传确认；
- 过期清理；
- 审计 action 映射。

集成测试：

- API + PostgreSQL + Redis + MinIO；
- 小文件直传；
- 大文件分片上传；
- 断网后恢复；
- 重复 complete；
- 无权限上传；
- 配额不足；
- 会话过期。

前端测试：

- 权限按钮渲染；
- 上传队列 reducer；
- 拖拽与文件夹路径解析；
- 大列表虚拟滚动冒烟测试。

CI：

1. install；
2. lint；
3. typecheck；
4. backend unit tests；
5. frontend unit tests；
6. docker compose 启动依赖；
7. migration；
8. integration smoke tests；
9. build。

### 10.3 验收标准

第 2 阶段验收：

- 用户可创建多个工作区；
- 同一用户在两个工作区看到的文件完全隔离；
- Owner/Admin 可邀请成员；
- 成员角色变更立即生效；
- VIEWER 无法通过 API 上传；
- 敏感操作可查审计日志；
- 旧文件迁移后仍可通过原 `urlKey` 访问。

第 3 阶段验收：

- 8 MB 以下小文件可直传；
- 100 MB 以上文件可分片上传；
- 刷新页面后可恢复未完成上传；
- 相同内容第二次上传命中秒传；
- 分片失败可自动重试并手动重试；
- 并发上传不会超过工作区配额；
- 过期会话释放预留配额；
- 图片和 PDF 上传后异步生成缩略图；
- API 文档和错误码可从 Swagger 查询。

## 11. 迁移与兼容策略

1. 新增工作区、成员、文件夹、版本、上传、配额、审计表。
2. 为每个已有 User 创建一个 `Personal Workspace`。
3. 将旧 `File` 映射到该个人工作区：
   - `created_by = user_id`；
   - 创建版本 1；
   - `hash` 暂时使用 `null` 或 `legacy:<uuid>`，后续可异步回填；
   - 保留 `url_key`。
4. 旧 `UserQuota.storage_limit/storage_used` 迁移到个人工作区 `quotas`。
5. 旧上传中 multipart 状态不迁移，发布前清空或等待过期。
6. 旧公开预览和下载接口改为按 `urlKey` 查询文件后走公开可见性校验。
7. 迁移必须先在本地备份导入生产快照演练，再在生产执行。
8. 生产发布顺序：
   - 数据库备份；
   - 执行 migration；
   - 发布后端；
   - 发布前端；
   - 观察 Sentry、日志、上传成功率和迁移统计。

## 12. 实施里程碑

### M0：规范与基线，0.5 天

- 建开发分支；
- 整理 ESLint/Prettier/TS strict；
- 建立模块边界 lint；
- 补 API 错误响应与 Swagger 基础；
- 新增 Docker Compose MinIO 与 worker；
- 补 `.env.example`。

### M1：数据模型与迁移，1 天

- 新增 Prisma 模型；
- 生成迁移；
- 为已有用户创建个人工作区；
- 迁移旧文件与配额；
- 编写迁移验证脚本。

### M2：Workspace/RBAC 后端，1.5 天

- Workspace CRUD；
- 成员与邀请；
- 权限矩阵；
- `WorkspaceGuard` 和 `PermissionGuard`；
- 审计服务；
- 单元与集成测试。

### M3：文件模型与工作区列表，1 天

- 新文件接口；
- 旧公开接口兼容；
- 工作区文件列表；
- 权限测试；
- 数据隔离测试。

### M4：上传会话与直传，1 天

- 上传 DTO；
- 会话创建；
- 配额预留；
- 预签名直传；
- complete 幂等；
- 秒传；
- 失败与取消。

### M5：分片流水线，1.5 天

- 分片 URL；
- 分片确认；
- 恢复查询；
- 合并；
- 过期清理；
- 并发与幂等测试。

### M6：异步任务与缩略图，1 天

- BullMQ；
- worker；
- 图片/PDF 缩略图；
- 状态回写；
- 重试测试。

### M7：前端工作区与权限，1 天

- 工作区状态；
- 创建/切换工作区；
- 成员管理；
- 邀请管理；
- 权限驱动 UI；
- 暗色模式适配。

### M8：前端上传队列，1.5 天

- 上传队列 Store；
- SHA-256；
- 拖拽与文件夹；
- 分片调度；
- 断点恢复；
- 进度、失败、取消、乐观更新。

### M9：测试、文档与发布演练，1 天

- 全量回归；
- 集成测试；
- 压测分片上传；
- 补 Swagger、README、架构图、ER 图；
- 本地生产 Compose 演练；
- 输出上线检查表。

## 13. 风险与决策

| 风险                                | 影响               | 决策                                          |
| ----------------------------------- | ------------------ | --------------------------------------------- |
| 旧数据缺少哈希                      | 无法秒传           | 迁移时标记 legacy，后续异步回填               |
| 对象存储哈希校验成本高              | 合并变慢           | 默认大小校验；服务端 SHA-256 异步或按配置开启 |
| S3 provider 对 multipart 行为不一致 | 合并失败           | 存储适配器封装并分别适配 MinIO/七牛           |
| 前端大文件 SHA-256 卡 UI            | 体验差             | 使用 Web Worker，不阻塞渲染                   |
| 配额并发竞态                        | 超卖               | 事务 + 行锁/条件更新 + 预留配额               |
| 权限漂移                            | 越权               | 权限矩阵单源 + 后端 Guard 全量校验            |
| 一次性改动过大                      | 回归风险           | 里程碑 M0-M9 分支合并，每个里程碑可验证       |
| MinIO 与生产七牛差异                | 本地通过但线上失败 | 上传和合并集成测试在两个驱动下跑核心路径      |

## 14. 已确认决策

### 14.1 代码规范工具

已确认使用“代码依赖图 + 模块边界规则 + ESLint 边界约束”落地代码规范，不引入名为 CodeGrah 的额外工具。

### 14.2 本地与生产对象存储

已确认采用双驱动策略：

- 本地开发：MinIO；
- 生产环境：继续使用七牛云；
- 后端通过统一 `StorageService` 和 `MinIOStorageDriver` / `QiniuStorageDriver` 隔离差异；
- 不在本次升级中迁移生产对象存储数据。

### 14.3 旧数据迁移

已确认每个已有用户迁移出一个 `Personal Workspace`，旧文件、旧配额和公开 `urlKey` 保持兼容。

### 14.4 同名文件策略

已确认新上传同名文件默认生成新文件，不做自动覆盖；覆盖或生成新版本的策略延后到版本管理阶段。

### 14.5 生产存储演进

生产暂不切换到 MinIO；后续若需要私有化部署或降低云存储成本，可基于存储驱动抽象另行评估。
