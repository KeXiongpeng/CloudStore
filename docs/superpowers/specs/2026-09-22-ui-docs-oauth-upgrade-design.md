# 云存储平台 UI / 文档 / OAuth 升级设计

## 背景

项目需要作为可面试展示的完整作品。当前缺少入口文档，首页视觉偏原型化，后台对移动端不友好，GitHub / Google OAuth 缺少可用回调配置，微信登录尚未实现。

## 已确认决策

- 生产域名：`https://kxpwty.cn`
- OAuth 回调统一走前端同源 `/api` 路径。
- GitHub / Google / WeChat 回调分别为 `/api/auth/github/callback`、`/api/auth/google/callback`、`/api/auth/wechat/callback`。
- 暂时没有微信开放平台凭证；后端实现能力，前端在未配置时隐藏微信登录。
- 测试账号通过 seed 提供：管理员账号和一个普通演示账号。
- 暂不制作演示视频；README 提供演示路径和说明。
- UI 采用已确认的 Figma 桌面首页方案：浅色背景、蓝色主色、卡片化信息、现代 SaaS 风格。
- 移动端不单独出 Figma 稿，直接使用 Tailwind 响应式实现。

## 交付范围

1. 文档与面试入口
   - 根目录 README。
   - 架构文档与 Mermaid 架构图。
   - 数据库文档与 Mermaid ER 图。
   - 接口文档。
   - 本地与生产部署说明。
   - 测试账号、演示路径和 OAuth 配置说明。

2. 首页与认证页
   - 首页按 Figma 方案实现。
   - 登录 / 注册页使用一致品牌视觉。
   - 第三方登录按钮只展示后端已配置的 provider。

3. 响应式布局
   - 后台桌面端保留侧边栏，移动端提供可开合菜单。
   - 文件列表桌面端使用表格，移动端使用卡片。
   - 所有关键页面在 375px、768px、1280px 宽度下不出现横向滚动或内容压缩。

4. OAuth 升级
   - 修复 GitHub / Google 回调和环境变量。
   - OAuth 授权请求加入 state，回调校验 state。
   - 处理第三方错误回调和缺失 email。
   - 保存第三方头像和昵称。
   - 新增 WeChat provider。
   - 新增 `GET /api/auth/providers`，前端据此渲染登录按钮。

5. Seed 与配置
   - Prisma enum 增加 `wechat`。
   - seed 管理员和演示用户。
   - `.env.example` 补齐 OAuth、站点 URL、演示账号变量。

## 非目标

- 不新增真实演示视频。
- 不申请或伪造微信凭证。
- 不重构文件上传、对象存储或权限模型。
- 不在生产文档中暴露真实密钥或密码。

## 验收标准

- `client` 和 `server` 均可通过 build。
- README 能让面试官理解项目、启动方式、技术栈、架构和演示账号。
- OAuth 未配置时页面不显示不可用按钮；配置后可跳转正确回调。
- `OAuthProvider` 支持 `github`、`google`、`wechat`。
- 首页、登录页、后台、文件列表在移动端可用。
