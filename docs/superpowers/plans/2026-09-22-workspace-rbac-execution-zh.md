# 工作区与 RBAC 中文执行计划

> **执行者须知：** 本文件是 `2026-09-22-workspace-rbac-implementation.md` 的中文执行清单。必须逐项执行，不能跳过验证。代码块、命令、文件路径和标识符保留英文。

## 目标

将现有个人网盘模型升级为多工作区系统，完成工作区、成员、邀请、角色、权限、数据隔离、审计日志和旧数据兼容迁移。

## 全局约束

- 工作区是文件、配额和审计日志的租户边界。
- 后端必须强制鉴权；前端权限控制只负责隐藏或禁用界面。
- 角色固定为 `OWNER`、`ADMIN`、`EDITOR`、`VIEWER`、`GUEST`。
- `ADMIN` 不能修改或移除 `OWNER`。
- 只有 `OWNER` 能删除工作区。
- 每个旧用户迁移出一个个人工作区。
- 旧文件必须保留原 `urlKey`。
- 本地开发继续在当前目录执行；生产存储暂不迁移。
- 禁止引入 Kubernetes。
- 所有新增查询必须包含 `workspaceId`。

## 执行前基线

- [x] 当前分支已从 `ui-docs-oauth-upgrade` 切换到 `feat/workspace-upload-pipeline`。
- [x] 服务端构建通过：`npm --prefix server run build`。
- [x] 客户端生产构建通过：`npm --prefix client run build`。
- [x] 客户端 ESLint 配置已在任务 0 补齐；存量类型和未用导入已修复。
- [x] Windows 下使用 `C:\Program Files\npm.cmd` 调用 npm。

## 任务清单

### 任务 0：工程规范、代码依赖图、统一响应和 CI

- [x] 安装 Prettier、ESLint、dependency-cruiser、Husky、lint-staged。
- [x] 创建 `.prettierrc`、`.prettierignore`、`.dependency-cruiser.cjs`、`.lintstagedrc.json`。
- [x] 建立模块依赖方向规则：`workspaces` 不依赖 `upload/storage`，`audit` 不反向依赖业务模块，前端不导入后端源码。
- [x] 创建统一成功响应拦截器和异常过滤器。
- [x] 保持前端响应解包兼容，避免现有页面立刻破坏。
- [x] 配置 Swagger。
- [x] 创建 GitHub Actions 质量流水线。
- [x] 初始化 Husky 和 lint-staged。
- [x] 验证依赖图、格式化、服务端测试和构建。
- [x] 提交：`chore(engineering): add dependency graph and api envelope`

### 任务 1：后端测试与严格类型基线

- [ ] 安装 Jest、ts-jest、supertest。
- [ ] 创建 `server/jest.config.js` 和 `server/test/setup-env.ts`。
- [ ] 添加 `test`、`test:watch`、`test:cov`、`typecheck` 脚本。
- [ ] 开启 `strict` 和 `noUncheckedIndexedAccess`。
- [ ] 验证现有测试和类型检查。
- [ ] 提交：`test(server): add workspace rbac test baseline`

### 任务 2：权限矩阵单一来源

- [ ] 创建 `WorkspaceRole`、`WorkspacePermission`、`WorkspaceActorContext` 类型。
- [ ] 创建权限矩阵 `WORKSPACE_ROLE_PERMISSIONS`。
- [ ] 实现并测试 `hasWorkspacePermission`。
- [ ] 确认 `OWNER` 拥有全部权限，`ADMIN` 不能删除工作区，`VIEWER` 不能上传。
- [ ] 提交：`feat(workspace): add role permission matrix`

### 任务 3：工作区 RBAC 数据模型

- [ ] 新增 `Workspace`、`WorkspaceMember`、`WorkspaceInvitation`、`AuditLog`。
- [ ] 为旧用户创建个人工作区。
- [ ] 为每个工作区创建 `OWNER` 成员记录。
- [ ] 回填旧文件的 `workspace_id` 和 `created_by`。
- [ ] 校验没有文件缺少工作区。
- [ ] 运行 Prisma 迁移和生成。
- [ ] 提交：`feat(workspace): add rbac schema and personal workspace migration`

### 任务 4：工作区服务和成员上下文

- [ ] 实现创建、列表、详情、更新、删除工作区。
- [ ] 实现 `requireMembership`。
- [ ] 禁用成员不能获得 actor 上下文。
- [ ] 工作区不存在时统一返回 `WORKSPACE_NOT_FOUND`。
- [ ] 注册 WorkspacesModule。
- [ ] 提交：`feat(workspace): add workspace crud and membership context`

### 任务 5：工作区 Guard 和权限 Guard

- [ ] 创建 `RequirePermission` 和 `WorkspaceActor` 装饰器。
- [ ] 实现 `WorkspaceGuard`。
- [ ] 实现 `PermissionGuard`。
- [ ] 校验无权限角色不能通过 Guard。
- [ ] 导出两个 Guard 供文件、上传、审计模块复用。
- [ ] 提交：`feat(workspace): enforce workspace rbac guards`

### 任务 6：审计日志服务与查询接口

- [ ] 实现 `AuditService.record`。
- [ ] 审计写入失败不能阻断业务主流程，但必须记录服务端日志。
- [ ] 实现 `AuditService.list` 分页和过滤。
- [ ] 审计查询必须要求 `audit:read`。
- [ ] 注册 AuditModule。
- [ ] 提交：`feat(audit): add workspace audit trail and query api`

### 任务 7：邀请与成员管理

- [ ] 实现成员列表。
- [ ] 实现邮箱邀请、接受邀请、角色修改、移除成员。
- [ ] 邀请令牌只保存 SHA-256 哈希。
- [ ] 邀请默认 7 天过期。
- [ ] 禁止修改或移除 `OWNER`。
- [ ] 所有敏感变更写审计日志。
- [ ] 提交：`feat(workspace): add invitations and member management`

### 任务 8：跨工作区隔离集成测试

- [ ] 创建 e2e Jest 配置。
- [ ] 注册用户 A 和用户 B。
- [ ] 用户 A 创建工作区。
- [ ] 用户 B 不能读取工作区 A。
- [ ] 用户 B 不能邀请成员到工作区 A。
- [ ] 提交：`test(workspace): prove cross workspace isolation`

### 任务 9：前端工作区上下文与成员管理

- [ ] 安装 TanStack Query、Zustand、React Hook Form、Zod。
- [ ] 创建前端权限展示矩阵。
- [ ] 创建工作区 API hooks。
- [ ] 创建当前工作区 store。
- [ ] 实现创建工作区页面。
- [ ] 实现成员列表、邀请、角色修改、移除成员页面。
- [ ] 根据角色禁用管理入口。
- [ ] 适配暗色模式。
- [ ] 验证构建和手动流程。
- [ ] 提交：`feat(client): add workspace switching and member management`

### 任务 10：旧接口兼容与第 2 阶段回归

- [ ] 文件列表、详情、删除改为工作区作用域。
- [ ] 公开预览继续支持旧 `urlKey`。
- [ ] 公开文件仍要求工作区 active 且文件未删除。
- [ ] 更新架构、数据库、API 文档。
- [ ] 跑完服务端单测、e2e、客户端 lint、客户端构建。
- [ ] 提交：`feat(workspace): complete rbac regression and docs`

## 每阶段验证命令

```bash
npm --prefix server run typecheck
npm --prefix server test -- --runInBand
npm --prefix server test -- --config test/jest-e2e.json --runInBand
npm --prefix client test -- --run
npm --prefix client run lint
npm --prefix client run build
npm run deps:graph
```

某条命令尚未实现时，必须先完成对应任务；不能把“脚本不存在”当作通过。

## 完成定义

- [ ] 所有任务复选框完成。
- [ ] 所有验证命令通过。
- [ ] 数据库迁移可以在干净本地库重复执行。
- [ ] 两个用户不能互相读取未加入的工作区。
- [ ] `VIEWER` 调用上传接口被后端拒绝。
- [ ] 邀请、角色变更、移除成员、工作区迁移都有审计日志。
- [ ] 旧文件公开链接仍可访问。
- [ ] 文档与实际接口一致。
