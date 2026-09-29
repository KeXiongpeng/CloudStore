# D7 优化交接文档：RAG 上下文、检索工具化与知识库交互

> 交接时间：2026-09-29  
> 交接人：上一个 Codex 会话  
> 目标读者：下一个 Codex / 开发会话  
> 当前分支：`feat/workspace-upload-pipeline`  
> 当前最新提交：`8ae66f7 docs(plan): record production deployment evidence`  
> 生产状态：已部署 `server:v10` + `client:v7`，生产域名 `https://cloudstore.kxpwty.cn`

---

## 1. 一句话目标

把当前“单轮问题 + 单次向量检索 + 固定兜底”的知识库问答，升级为：

```text
多轮上下文
→ 意图/查询规划
→ 检索工具
→ 判断是否有答案
→ 流式回答 / 引导用户补充资料
→ 交互卡片与文件状态可视化
```

不要把这次优化做成“引入一个大而全 Agent 框架”。当前项目已经有 LangGraph StateGraph、自研 `LlmService`、pgvector 检索、SSE 和 worker，本次应继续复用这些边界。

---

## 2. 当前项目状态

### 2.1 已完成

- D1-D3 项目链路已完成，学习笔记在 `embedding-pgvector-学习/01-*.md` 到 `22-*.md`。
- D4 项目主线已完成：手写 RAG loop 已重构为 LangGraph StateGraph。
- D5 项目主线已完成：20 题 RAG 评估集、evaluation runner、JSON + Markdown 报告。
- D6 已部署生产：
  - API：`server:v10`
  - 前端：`client:v7`
  - PostgreSQL：`pgvector/pgvector:pg16`
  - 生产目录：`/opt/cloud-storage`
  - 生产域名：`https://cloudstore.kxpwty.cn`
- 生产冒烟已通过：登录、上传、indexed、RAG SSE、引用、无关兜底、空 workspace 隔离。
- 最新数据库备份：
  - 服务器：`/opt/cloud-storage/backups/postgres-cloud_storage-20260929134628.sql`
  - 本地：`production-backups/postgres-cloud_storage-20260929134628.sql`

### 2.2 当前分支和部署

```bash
branch: feat/workspace-upload-pipeline
HEAD:   8ae66f7 docs(plan): record production deployment evidence
remote: 已推送到 https://github.com/KeXiongpeng/CloudStore.git
```

生产 Compose：

```text
/opt/cloud-storage/docker-compose.prod.yml
```

生产服务：

```text
cloud-storage-nestjs-1          server:v10
cloud-storage-server-worker-1   server:v10
cloud-storage-nextjs-1          client:v7
cloud-storage-postgres-1        pgvector/pgvector:pg16
cloud-storage-redis-1           redis:7-alpine
```

注意：

- ACR 镜像推送当时被本机 Docker 代理反复中断，最终使用 `docker save` / `scp` / `docker load` 将镜像传到服务器。
- 如果后续要重新走 ACR，应先解决本机 Docker proxy 稳定性，或直接在服务器构建。

---

## 3. 用户已经观察到的问题

### 3.1 对话没有上下文

现象：

```text
用户：我的网站 SEO 数据怎么样。
AI：正常回答 SEO 健康评分、技术 SEO、内容质量等。

用户：有多少问题。
AI：知识库中没有找到足够相关的资料...
```

第二个问题在人类语境里明显是追问：

```text
这份 SEO 报告里有多少个问题？
```

但后端当前只收到：

```json
{
  "question": "有多少问题。"
}
```

后端没有历史消息，所以向量检索直接拿“有多少问题”去查，语义不完整；`judgeRelevance()` 也只能判断“这句话 + 检索片段”，无法知道用户指的是上一轮 SEO 审计报告。

### 3.2 有 sources 但仍然兜底

当前 fallback 节点会继续发出 `sources`：

```ts
// server/src/chat/rag/rag-graph.factory.ts
const fallback = async (state) => {
  onEvent({ type: 'sources', sources: state.sources });
  onEvent({ type: 'delta', content: NO_RELEVANT_SOURCE_FALLBACK });
  onEvent({ type: 'done', done: true });
};
```

所以用户看到的是：

- 5 个引用来源；
- 但正文却是“知识库中没有找到足够相关的资料”。

这在调试时有价值，但对普通用户很矛盾。修复上下文后应该减少误判；如果仍然无答案，UI 应把来源降级为“参考片段/调试来源”，并配合交互卡片说明下一步。

### 3.3 用户不知道当前 workspace 有没有可用知识库

当前聊天页：

```text
client/src/app/(dashboard)/chat/page.tsx
```

只渲染：

```tsx
<ChatPanel />
```

`ChatPanel` 只关心当前 workspace 和本地聊天会话，没有调用文件列表或知识库索引状态。因此用户进入 `/chat` 后不知道：

- 当前 workspace 是否有文件；
- 有几个文件已 indexed；
- 是否有 processing / failed；
- 是否需要先上传；
- 哪些文件类型可以进入知识库。

### 3.4 上传页和文件管理页重复

当前导航：

```text
/upload  上传文件
/files   文件管理
/chat    知识库问答
```

`/upload` 主要是：

```tsx
<UploadDropzone />
<UploadQueuePanel />
```

`/files` 已经同时包含：

- 文件列表；
- `UploadDropzone`；
- `UploadQueuePanel`；
- 预览、下载、删除、reindex。

所以上传页和文件管理页能力高度重复。建议后续保留 `/files` 作为唯一“文件与知识库”工作台，弱化或重定向 `/upload`。

---

## 4. 本次优化的三个主目标

## P0：多轮上下文

让模型知道“上一轮问了什么、上一轮回答了什么”，并能把追问改写成完整检索查询。

## P1：检索工具化

把向量检索显式抽象成一个工具：

```text
search_knowledge_base(query, limit)
```

由 planner / agent 决定什么时候调用；工具内部强制使用当前 `workspaceId`，不把 workspaceId 暴露给模型自由填写。

## P2：交互卡片与知识库状态

聊天页能主动告诉用户当前知识库状态，并在合适时机推荐动作：

- 上传文件；
- 前往文件管理；
- 查看引用；
- 重新索引；
- 换个问法。

## P3：页面整合

把“上传文件”和“文件管理”整合成一个文件与知识库工作台，减少重复入口。

---

## 5. 当前关键源码地图

## 后端 RAG

| 文件                                        | 当前职责                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| `server/src/chat/chat.controller.ts`        | POST SSE 入口，写 `sources/delta/done/error`                                  |
| `server/src/chat/chat.service.ts`           | 构造 `RagGraphState`，调用 `RagGraphService`                                  |
| `server/src/chat/dto/ask-question.dto.ts`   | 目前只有 `question` 和 `limit`                                                |
| `server/src/chat/rag/rag-state.ts`          | LangGraph State：question/query/workspaceId/sources/relevance/rewriteCount 等 |
| `server/src/chat/rag/rag-graph.factory.ts`  | retrieve → judge → rewriteQuery → generate → fallback                         |
| `server/src/chat/rag/rag-graph.service.ts`  | `graph.invoke()`，事件写入 `AsyncEventQueue`                                  |
| `server/src/chat/rag/async-event-queue.ts`  | LangGraph node 事件桥接为 `AsyncGenerator`                                    |
| `server/src/chat/llm.service.ts`            | `streamChat()`、`complete()`、`judgeRelevance()`、`rewriteQuery()`            |
| `server/src/documents/documents.service.ts` | pgvector workspace 检索                                                       |

当前 `RagGraphState` 没有 history/session 字段：

```ts
originalQuestion;
currentQuery;
workspaceId;
limit;
sources;
relevance;
relevanceReason;
rewriteCount;
retrieveCount;
maxRewrites;
lastRewrittenQuery;
errorMessage;
answer;
```

当前 DTO：

```ts
export class AskQuestionDto {
  question!: string;
  limit: number = 5;
}
```

当前生产/前端 SSE 协议：

```ts
type ChatStreamEvent =
  | { type: 'sources'; sources: TraceableSearchResult[] }
  | { type: 'delta'; content: string }
  | { type: 'done'; done: true }
  | { type: 'error'; message: string };
```

本次可以向后追加事件，但不要破坏既有四个事件。

## 前端聊天

| 文件                                          | 当前职责                                        |
| --------------------------------------------- | ----------------------------------------------- |
| `client/src/app/(dashboard)/chat/page.tsx`    | 只挂载 `ChatPanel`                              |
| `client/src/features/chat/ChatPanel.tsx`      | 输入、会话、SSE 消费、气泡、来源、停止、重试    |
| `client/src/features/chat/api.ts`             | POST SSE 请求                                   |
| `client/src/features/chat/sse.ts`             | 解析 POST SSE                                   |
| `client/src/features/chat/conversation.ts`    | reducer：askStart/sources/delta/done/error/stop |
| `client/src/features/chat/session-storage.ts` | localStorage 多会话持久化                       |
| `client/src/features/chat/types.ts`           | ChatSource / ChatSseEvent / ChatMessage         |

注意：前端已有本地多会话，但后端不知道这些会话；这只能恢复 UI，不能给模型提供服务端上下文。

## 文件 / 上传

| 文件                                             | 当前职责                                                      |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `client/src/app/(dashboard)/upload/page.tsx`     | `UploadDropzone` + `UploadQueuePanel`                         |
| `client/src/app/(dashboard)/files/page.tsx`      | 文件列表、上传、队列、预览、下载、删除、reindex               |
| `client/src/features/upload/api.ts`              | 上传 session / direct-url / chunk-url / complete / instant    |
| `client/src/features/upload/runner.ts`           | 秒传、直传、分片、重试、队列调度                              |
| `client/src/components/Sidebar.tsx`              | 同时有“上传文件”和“文件管理”入口                              |
| `server/src/files/workspace-files.controller.ts` | 文件 list / stats / access-url / content / reindex / delete   |
| `server/src/files/workspace-files.service.ts`    | 文件列表、知识库索引状态、删除同步清理 Document/chunks、stats |

已有接口：

```http
GET /api/workspaces/:workspaceId/files?page=1&limit=20
GET /api/workspaces/:workspaceId/files/stats
POST /api/workspaces/:workspaceId/files/:fileId/reindex
```

但 `stats()` 当前只返回：

```ts
{
  totalFiles,
  totalViews,
  totalDownloads,
  totalSize,
}
```

没有按 `pending / processing / indexed / failed` 统计，聊天页无法用现有 stats 精确展示知识库健康状态。

---

## 6. P0：多轮上下文

## 6.1 推荐数据模型

新增 Prisma 模型：

```prisma
model ChatSession {
  id          String   @id @default(uuid())
  workspaceId String   @map("workspace_id")
  userId      String   @map("user_id")
  title       String   @default("新会话")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages  ChatMessage[]

  @@index([workspaceId, userId, updatedAt])
  @@map("chat_sessions")
}

model ChatMessage {
  id         String   @id @default(uuid())
  sessionId  String   @map("session_id")
  role       String   @db.VarChar(16)
  content    String   @db.Text
  sources    Json?
  createdAt  DateTime @default(now()) @map("created_at")

  session ChatSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
  @@map("chat_messages")
}
```

实际写 Prisma 时需要根据现有 `Workspace` / `User` relation 命名调整，不要照抄导致 relation 名冲突。

## 6.2 API 契约扩展

当前：

```json
POST /api/workspaces/:workspaceId/chat
{
  "question": "有多少问题",
  "limit": 5
}
```

建议扩展为：

```json
POST /api/workspaces/:workspaceId/chat
{
  "sessionId": "optional-existing-session-id",
  "question": "有多少问题",
  "limit": 5
}
```

后端行为：

1. 如果 `sessionId` 为空，创建 `ChatSession`。
2. 如果 `sessionId` 存在，校验：
   - session 存在；
   - `session.workspaceId === route workspaceId`；
   - `session.userId === 当前用户 id`。
3. 保存用户消息。
4. 加载最近 N 条历史，建议 N = 8 或 10 条 message，不是 8 轮完整长文。
5. 先用历史做 query condensation。
6. 检索。
7. 生成。
8. done 后保存 assistant message 和 sources。
9. SSE 中发送 session 元数据。

可以新增一个不破坏旧协议的事件：

```ts
| { type: 'session'; session: { id: string; title: string } }
```

前端 reducer 保存 `sessionId`。旧前端如果不识别该事件，应忽略 unknown event。

## 6.3 后端 State 扩展

在 `RagGraphState` 增加：

```ts
history: Annotation<ChatHistoryMessage[]>({
  reducer: (_previous, next) => next,
  default: () => [],
}),
sessionId: Annotation<string | undefined>(),
```

类型建议：

```ts
export type ChatHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};
```

不要把完整的 `sources`、HTML、文件二进制、函数引用塞进 history。

## 6.4 新增 condenseQuestion 节点或服务

推荐新增独立方法：

```ts
async condenseQuestion(
  history: ChatHistoryMessage[],
  question: string,
): Promise<string>
```

Prompt 目标：

```text
你负责把用户最新问题改写成一个不依赖上下文也能理解的 standalone query。
只输出一行查询。
如果最新问题已经完整，不要改写。
不要回答问题。
不要补充事实。
```

示例：

```text
history:
user: 我的网站 SEO 数据怎么样。
assistant: SEO 健康评分 42/100...技术 SEO 35...内容质量 45...
user: 有多少问题。

condensed:
artflo.ai SEO 全站审计报告中列出了多少个问题？
```

然后 `searchKnowledgeBase` 使用 condensed query，而最终生成仍应收到：

- condensed query；
- 最近少量 history；
- sources。

这样模型能知道“有多少问题”指的是上一轮报告。

## 6.5 history 窗口与 token 预算

第一版不要做复杂长期记忆：

- 只取最近 8-10 条 message；
- 每条 content 截断，例如单条最多 2000 字符；
- 总 history 预算建议 4000-6000 字符；
- assistant sources 不放进 history prompt，只保留正文；
- 超出窗口先直接丢弃旧消息，不要第一版就做摘要。

如果后续做长期记忆，再增加：

```text
ConversationSummary
```

但当前 YAGNI。

## 6.6 前端会话同步

`ChatPanel` 目前用 localStorage 作为唯一会话源。本次要避免双源冲突，建议：

- 后端成为事实来源；
- localStorage 只做缓存；
- `ChatPanel` 发送时携带 `sessionId`；
- 收到 `session` SSE 事件后更新当前 `sessionId`；
- 新会话第一次完成后写入本地 cache；
- 切换 workspace 时不复用其他 workspace 的 sessionId；
- 用户点“新会话”时清空当前 `sessionId`，等后端创建新 session。

不要简单地把 localStorage 里所有历史消息一次性发给后端。

---

## 7. P1：检索工具化

## 7.1 设计原则

检索必须是一个显式工具，而不是隐式把用户原句塞进向量搜索。

推荐工具名：

```ts
search_knowledge_base;
```

第一版 schema：

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "用于向量检索的完整 standalone query"
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 10,
      "default": 5
    }
  },
  "required": ["query"]
}
```

安全规则：

- `workspaceId` 不进入 LLM tool 参数；
- 后端 planner 决定调用工具时，从当前登录用户和 route param 注入 `workspaceId`；
- 不允许模型调用 delete/upload/reindex；
- tool 参数必须校验；
- tool 错误转成稳定用户文案，不暴露 Axios body 或 key。

## 7.2 推荐图结构

第一阶段不要直接上复杂多 Agent。建议保持 StateGraph：

```text
START
→ condenseQuestion
→ planToolUse
→ search_knowledge_base
→ judge
→ generate / rewrite / fallback
→ END
```

更具体：

```text
START
→ condenseQuestion
→ planToolUse
→ searchKnowledgeBase
→ judge
   ├ relevant → generate
   ├ irrelevant + rewrite budget → rewriteQuery
   ├ irrelevant + no budget + sources weak → guidedFallback
   └ retrieve error → error
→ END
```

`planToolUse` 第一版可以很轻：

- 默认尝试 `search_knowledge_base`；
- 如果历史能明显回答，可以让 planner 输出 `answer_from_history`；
- 如果用户明显在闲聊，可以输出 `clarify`；
- 不需要第一版就支持多个工具。

## 7.3 两种实现路径

### 方案 A：继续手写 OpenAI-compatible tool call

优点：

- 不新增 LangChain 模型依赖；
- 与当前 `LlmService` / Axios 结构一致；
- SSE 和错误处理保持可控。

做法：

1. `LlmService.planWithTools(messages, tools)`。
2. 请求体增加 OpenAI-compatible `tools` 和 `tool_choice: 'auto'`。
3. 解析 `choices[0].message.tool_calls`。
4. 只允许 `search_knowledge_base`。
5. 参数用 Zod 或 class-validator 校验。
6. 调用 `DocumentsService.search(query, limit, workspaceId)`。

### 方案 B：引入 LangChain model + LangGraph ToolNode

优点：

- 更贴合 LangGraph 生态；
- 后续扩展工具更容易。

缺点：

- 需要新增 `@langchain/openai` 或兼容模型包；
- 需要处理 streaming / tool call / error 的差异；
- 当前项目已经自研 `LlmService`，短期收益不高。

建议：

第一版用方案 A。等工具数量超过 2-3 个，再考虑方案 B。

## 7.4 无结果时的引导策略

不要继续只回固定一句：

```text
知识库中没有找到足够相关的资料...
```

应区分三种情况：

### 情况 A：workspace 没有可索引文件

回答：

```text
当前工作区还没有可问答的知识库文件。
```

Action：

```text
[上传知识库文件] [查看文件管理]
```

### 情况 B：有 indexed 文件，但检索无结果

回答应包含：

```text
我在当前知识库里没有找到与「xxx」直接相关的资料。
你可以尝试：
1. 补充文件名、时间、产品名或章节名；
2. 上传包含该信息的文档；
3. 换成更具体的问题。
```

Action：

```text
[上传补充资料] [查看已索引文件]
```

### 情况 C：有相似来源，但不足以直接回答

不要硬说“没有资料”。应回答：

```text
我在知识库里找到了一些相关片段，但还不足以完整回答这个问题。
以下是可能相关的来源：
...
如果你能补充 xxx，我可以继续帮你整理。
```

Action：

```text
[查看来源] [上传补充资料]
```

这个策略能修复当前截图里“有 5 个来源但仍然说没有资料”的体验矛盾。

---

## 8. P2：知识库状态与交互卡片

## 8.1 新增知识库统计接口

新增：

```http
GET /api/workspaces/:workspaceId/knowledge/stats
```

返回：

```json
{
  "totalFiles": 12,
  "indexableFiles": 8,
  "indexed": 6,
  "processing": 1,
  "pending": 0,
  "failed": 1,
  "unsupported": 4,
  "lastIndexedAt": "2026-09-29T07:00:00.000Z"
}
```

也可以扩展现有：

```http
GET /api/workspaces/:workspaceId/files/stats
```

但为了语义清晰，建议新增 knowledge stats。

统计来源：

- `File.workspaceId`
- `File.deletedAt = null`
- `File.name` 扩展名属于 `.md` / `.txt` / `.pdf`
- 关联 `Document.indexStatus`

## 8.2 ChatPanel 顶部状态条

进入 `/chat` 后请求 knowledge stats：

```text
当前工作区：xxx
知识库：6 indexed · 1 processing · 1 failed
[查看文件] [上传文件]
```

状态变化策略：

- 页面加载时请求一次；
- 上传完成或 reindex 后刷新；
- 每次提问后如果状态是 processing，轮询一次；
- 不需要长时间高频轮询。

## 8.3 SSE actions / cards

新增事件：

```ts
| {
    type: 'actions';
    actions: ChatAction[];
  }
```

Action 类型：

```ts
export type ChatActionType = 'navigate' | 'upload' | 'reindex' | 'retry' | 'openSources';

export type ChatAction = {
  id: string;
  type: ChatActionType;
  label: string;
  href?: string;
  payload?: Record<string, unknown>;
};
```

示例：

```json
{
  "type": "actions",
  "actions": [
    {
      "id": "upload-1",
      "type": "navigate",
      "label": "上传知识库文件",
      "href": "/files?upload=1"
    },
    {
      "id": "files-1",
      "type": "navigate",
      "label": "查看文件管理",
      "href": "/files"
    }
  ]
}
```

前端 reducer：

```ts
| { type: 'actions'; messageId: string; actions: ChatAction[] }
```

`ChatMessage` 增加：

```ts
actions?: ChatAction[];
```

## 8.4 Action 来源规则

Action 必须由后端状态推导，不要让 LLM 随意生成 URL。

| 状态                        | Action                        |
| --------------------------- | ----------------------------- |
| workspace 无 indexable 文件 | 上传知识库文件 / 查看文件管理 |
| 有 processing 文件          | 查看文件状态                  |
| 有 failed 文件              | 重试索引 / 查看失败原因       |
| 检索无结果                  | 上传补充资料 / 查看已索引文件 |
| 有相似但不完整来源          | 查看来源 / 上传补充资料       |
| 正常回答且有来源            | 查看来源 / 继续追问           |

不要把模型输出直接映射成按钮 `href`。

---

## 9. P3：整合上传页与文件管理页

建议最终信息架构：

```text
/files
  标题：文件与知识库
  Tab 1：全部文件
  Tab 2：知识库状态
  Tab 3：上传队列
  右上角：上传按钮
```

`/upload` 的处理：

- 先保留路由，避免旧链接失效；
- 页面重定向到 `/files?upload=1`；
- Sidebar 只保留一个入口：`文件与知识库`；
- `/chat` 的 action 跳转到 `/files?upload=1`。

不要直接删除 `/upload` 路由，先做兼容重定向，等确认没有外部依赖再移除。

---

## 10. P4：修复当前误兜底

上一轮 SEO 例子里，第二问“有多少问题”本应有答案。建议新增多轮回归用例：

```json
{
  "id": "multi-turn-seo-count",
  "history": [
    {
      "role": "user",
      "content": "我的网站 SEO 数据怎么样。"
    },
    {
      "role": "assistant",
      "content": "SEO 健康评分 42/100...核心问题是 Next.js CSR..."
    }
  ],
  "question": "有多少问题。",
  "expected": {
    "behavior": "answer",
    "mustMention": ["SEO", "问题", "审计报告"],
    "requireCitation": true
  }
}
```

判断顺序：

1. `condenseQuestion()` 输出应类似：

```text
artflo.ai SEO 全站审计报告中列出了多少个问题？
```

2. `search_knowledge_base` 使用 condensed query。
3. `judgeRelevance()` 应收到 condensed query 和 history 摘要。
4. 如果 sources 里包含 Critical / High / Medium 问题清单，应进入 generate。
5. 生成 prompt 明确告诉模型：

```text
用户最新问题可能是对上一轮内容的追问。
请结合对话上下文理解用户意图，但答案仍必须来自提供的资料。
```

---

## 11. 建议实施顺序

## Phase 0：回归锁定

1. 当前 server / client tests、typecheck、build 全部通过后再动。
2. 记录当前生产镜像 tag 和数据库备份。
3. 给现有 chat controller / service 补最小测试：
   - 无 `sessionId` 也能兼容；
   - 有 `sessionId` 会加载 history；
   - SSE 旧事件不破坏。

## Phase 1：服务端会话

1. 新增 Prisma `ChatSession` / `ChatMessage`。
2. 新增 `ChatSessionService`。
3. 扩展 `AskQuestionDto`。
4. `ChatService.answerStream()` 接收 session。
5. SSE 新增可选 `session` 事件。
6. done 后持久化 user / assistant message。
7. 单元测试 + E2E 多轮请求。

## Phase 2：上下文改写

1. 新增 `condenseQuestion()`。
2. 扩展 `RagGraphState.history`。
3. 在 retrieve 前新增 condense 节点。
4. `judgeRelevance()` 增加 history 摘要参数。
5. `buildGenerationMessages()` 增加 history 摘要。
6. 增加上文多轮测试。

## Phase 3：检索工具化

1. 定义 `search_knowledge_base` tool schema。
2. `LlmService` 增加 tool call planner。
3. 工具参数校验。
4. `workspaceId` 服务端注入。
5. StateGraph 接入 tool node / tool function。
6. 记录 toolCall / toolResult 便于调试。
7. 无结果改为 guided fallback。

## Phase 4：Actions / Cards

1. 扩展前端 SSE type。
2. reducer 支持 `actions`。
3. ChatPanel 渲染按钮。
4. 后端新增 action builder。
5. fallback / no-file / failed 状态生成 actions。
6. 禁止模型直接生成 href。

## Phase 5：知识库状态条

1. 后端新增 knowledge stats。
2. ChatPanel 请求 stats。
3. 顶部显示 indexed / processing / failed。
4. workspace 切换时刷新。
5. 上传完成或 reindex 后刷新。

## Phase 6：页面整合

1. `/files` 改成统一文件与知识库工作台。
2. `/upload` 重定向 `/files?upload=1`。
3. Sidebar 合并入口。
4. Chat action 跳转新入口。
5. 删除重复 UI 逻辑，保留 `UploadDropzone` / `UploadQueuePanel` 组件复用。

---

## 12. 测试要求

## 后端单元测试

- `condenseQuestion()`：
  - 有 history 时能合并指代；
  - 无 history 时保持原问题；
  - 输出单行；
  - 不编造答案。
- `judgeRelevance()`：
  - 接收 history summary；
  - JSON 合法；
  - 解析失败有安全降级。
- `search_knowledge_base` tool：
  - 参数校验；
  - `workspaceId` 服务端注入；
  - limit 最大 10；
  - 检索异常转稳定错误。
- fallback action builder：
  - no files / no result / weak sources 分别生成不同 actions。
- ChatSession 权限：
  - 跨 workspace 禁止读取；
  - 跨 user 禁止读取。

## 前端测试

- reducer 支持 `session` / `actions`；
- 未知 SSE event 不崩溃；
- fallback 渲染 action buttons；
- action 不执行模型生成的任意 URL；
- workspace 切换后 sessionId 重置；
- localStorage 旧数据兼容。

## 集成测试

- 第一问能回答；
- 第二问“有多少问题”不再误兜底；
- 空 workspace 提示上传；
- 无结果提示补充资料；
- SSE 顺序兼容：

```text
sources → delta... → done
```

新增事件只能附加，不能替换。

## 多轮评估

建议在 D5 评估集外新增 `multi-turn-eval-set-v1`：

| Case                                     | 目的                    |
| ---------------------------------------- | ----------------------- |
| SEO 报告第一问 + “有多少问题”            | 上下文追问              |
| KYC 文档第一问 + “我的待 KYC 账号有几个” | 上下文追问              |
| “它是什么意思”                           | 缺少 antecedent，应澄清 |
| “帮我上传文件”                           | tool/action，不检索     |
| “你是谁”                                 | small talk，不检索      |

---

## 13. 学习交接

## 13.1 当前学习状态

已学完：

- D1：Embedding、维度、余弦、pgvector 定位、本地环境、Prisma 建模、HNSW、向量化、入库、查询。
- D2：切块、headingPath、代码块保护、贪心装箱、幂等导入、事务重建、批量 embedding、可溯源检索。
- D3：检索问答、Prompt 组装、引用溯源、SSE、LLM 流式解析、前端 POST SSE、停止失败兜底、workspace 隔离。

项目已完成但学习未开始：

- D4：LangGraph / StateGraph / 条件路由 / query rewrite / checkpoint。
- D5：RAG 评估集、Hit@K、MRR、LLM-as-Judge、评估驱动优化。
- D6：生产部署、pgvector 迁移、镜像构建、备份、回滚。
- D7：本次优化相关的新知识。

注意：

- `syllabus.md` 里 D1 “四、项目实战” 4 项仍标记遗留。
- D3 已学，但按 `review-plan.md` 第 1 次复习日期是 2026-09-28，当前已逾期。
- D2 有 5 项第 2 次复习日期是 2026-10-04。
- D4/D5 交接文档里的知识点是项目视角，不等于已经费曼通关。

## 13.2 复习优先级

### P0：先补 D3 逾期复习

复习入口：

- `16-D3检索问答最小闭环.md`
- `17-Prompt组装与引用溯源.md`
- `18-SSE后端协议.md`
- `19-LLM上游流式解析.md`
- `20-前端POST与SSE读取.md`
- `21-停止失败与兜底.md`
- `22-工作区隔离检索.md`

建议每项用一个问题闭卷复述：

1. 最小 RAG 闭环里，什么时候只检索、什么时候生成？
2. Prompt 的 `[1]/[2]` 为什么必须和 sources 数组顺序一致？
3. SSE 为什么用 named event？`sources/delta/done/error` 分别负责什么？
4. OpenAI-compatible delta 为什么不能假设一个网络 chunk 就是一个完整事件？
5. 前端为什么不能用 `EventSource`？
6. 检索为空、LLM 失败、用户停止分别怎么处理？
7. workspace 隔离有哪几层？

### P1：D2 到期复习

日期：2026-10-04  
范围：

- 文档切块
- 幂等导入
- 事务重建
- 可溯源检索
- 批量 embedding

这次优化会直接碰到切块和检索，所以先复习很值。

### P2：D4 项目知识学习

新会话优化过程中可以同步学：

| 主题                        | 对应源码                                        | 学习问题                                 |
| --------------------------- | ----------------------------------------------- | ---------------------------------------- |
| StateGraph 与 RAG 状态      | `rag-state.ts`                                  | State 为什么只放可序列化数据？           |
| Node / partial state        | `rag-graph.factory.ts`                          | Node 为什么返回 partial state？          |
| Conditional edge            | `routeAfterJudge()`                             | relevant / rewrite / fallback 怎么路由？ |
| Query rewrite               | `rewriteQuery()`                                | 为什么要 rewrite？失败时怎么降级？       |
| Checkpoint 概念             | `compile()` 注释                                | 当前为什么没用持久化 checkpoint？        |
| LangGraph vs AsyncGenerator | `rag-graph.service.ts` / `async-event-queue.ts` | 两者边界是什么？                         |

### P3：D5 评估学习

对应源码：

```text
server/src/evaluation/
```

学习点：

- 评估集为什么要覆盖单源、多源、口语化、兜底、隔离；
- Hit@1 / Hit@3 / MRR；
- sourceCoverage；
- LLM-as-Judge 的偏差；
- baseline / after report；
- judgeError 为什么不能混入答案平均分。

### P4：D6 部署学习

对应变更和文档：

```text
docs/DEPLOYMENT.md
docs/ARCHITECTURE.md
docker-compose.prod.yml
docker-compose.prod-local.yml
```

学习点：

- 多阶段 Docker build；
- Next.js standalone；
- NestJS API 与 worker 分离；
- PostgreSQL 普通镜像 vs pgvector 镜像；
- Prisma migrate deploy；
- pg_dump 备份；
- additive migration 与失败 migration resolve；
- shared Nginx Proxy；
- SSE buffering；
- 生产 env 不入库。

## 13.3 本次优化会引入的新学习点

这些不在原 D1-D6 学习路线里，优化时遇到了应补进 `syllabus.md` / `review-plan.md`。

### A. 多轮上下文

- conversation history；
- short-term memory；
- history window；
- token budget；
- condense question / contextualize query；
- standalone question；
- assistant message truncation；
- server-side session vs client-side localStorage；
- ChatSession / ChatMessage 数据建模。

建议课程名：

```text
23-多轮对话上下文与Query改写.md
```

### B. Tool Calling

- function calling / tool calling；
- tool schema；
- tool choice；
- tool arguments 校验；
- tool result 注回模型；
- tool error handling；
- LangGraph ToolNode 概念；
- deterministic workflow vs autonomous agent；
- 为什么不能让模型传 workspaceId。

建议课程名：

```text
24-检索工具化与ToolCalling.md
```

### C. Structured Output

- JSON mode；
- JSON schema；
- strict output；
- JSON parse 失败降级；
- enum 输出；
- planner output；
- judge output。

建议课程名：

```text
25-结构化输出与意图路由.md
```

### D. Prompt Injection 与文档不可信内容

当前知识库内容会进入 prompt，因此文档本身是不可信输入。

学习点：

- document prompt injection；
- 工具参数注入；
- 模型输出与后端 action 的边界；
- 为什么 action URL 必须后端生成；
- workspace 隔离在多轮会话中的意义。

建议课程名：

```text
26-RAG PromptInjection与安全边界.md
```

### E. 多轮 RAG 评估

D5 的 20 题主要是单轮。本次新增：

- conversation-level evaluation；
- follow-up query rewrite correctness；
- answer relevance；
- tool call correctness；
- fallback correctness；
- citation stability；
- token cost；
- latency。

建议课程名：

```text
27-多轮RAG评估与回归.md
```

### F. 前端交互架构

学习点：

- reducer 扩展；
- custom hooks 拆分，例如 `useChat` / `useWorkspaceKnowledgeStats`；
- action card protocol；
- optimistic UI；
- polling vs SSE 状态同步；
- route-level IA；
- accessible buttons；
- localStorage 缓存策略。

建议课程名：

```text
28-聊天交互ActionCards与前端状态拆分.md
```

### G. Prisma 会话持久化

学习点：

- ChatSession / ChatMessage schema；
- workspace/user ownership；
- index 设计；
- message 分页；
- JSON sources 存储；
- 软删除或保留策略；
- token 与存储成本。

建议课程名：

```text
29-ChatSession持久化与租户隔离.md
```

---

## 14. 新知识学习计划建议

不要一次性学完再写代码。建议边做边学，按下面顺序：

| 阶段 | 项目任务                   | 同步学习                                 |
| ---- | -------------------------- | ---------------------------------------- |
| 1    | 补 D3 复习                 | 只复习，不写新功能                       |
| 2    | 服务端 ChatSession         | Prisma 建模、多租户校验                  |
| 3    | history + condenseQuestion | 多轮上下文、query rewrite                |
| 4    | 检索工具化                 | tool calling、tool schema、tool error    |
| 5    | guided fallback            | structured output、UX copy               |
| 6    | actions/cards              | SSE protocol extension、frontend reducer |
| 7    | knowledge stats            | SQL aggregate、状态同步                  |
| 8    | 页面整合                   | React IA、route redirect                 |
| 9    | 多轮评估                   | D5 评估扩展                              |
| 10   | 部署                       | migration、backup、rollback              |

---

## 15. 风险与边界

| 风险                                 | 控制                                             |
| ------------------------------------ | ------------------------------------------------ |
| 旧前端遇到新 SSE event 崩溃          | 前端 unknown event 必须忽略                      |
| session 跨 workspace 泄漏            | ChatSession 必须同时校验 workspaceId + userId    |
| history 太长                         | 第一版只取最近 8-10 条，并截断                   |
| LLM 改写追问失败                     | 保留原问题，安全降级                             |
| tool call 参数不可信                 | Zod/class-validator 校验，workspaceId 服务端注入 |
| 文档内容包含 prompt injection        | 文档内容标记为资料，不允许触发后端 action        |
| fallback 仍然显示 sources            | UI 区分“答案来源”与“参考片段”                    |
| 多轮上下文增加成本                   | history window + 单条截断 + 只摘要 sources 标题  |
| localStorage 和后端 session 双源冲突 | 后端为准，localStorage 只做 cache                |
| 直接上生产                           | 先走本地 prod-like rehearsal                     |

---

## 16. 验收标准

## 功能验收

1. 第一轮问题正常回答并带引用。
2. 上一轮问 SEO 报告后，第二轮问“有多少问题”不再误兜底。
3. 后端能根据 history 生成 standalone query。
4. 检索作为显式工具被调用，参数可追踪。
5. 无结果时输出引导性回复，不再只是固定一句话。
6. 无结果 / 无文件 / failed 状态出现对应 action card。
7. Chat 页能看到当前 workspace 的 indexed / processing / failed 数量。
8. 上传与文件管理入口整合，不再让用户猜去哪里上传。
9. 空 workspace 不泄露其他 workspace 数据。
10. SSE 旧事件仍然兼容。

## 技术验收

1. Server tests / typecheck / build 通过。
2. Client tests / typecheck / build 通过。
3. 新增 Prisma migration 可重复部署。
4. ChatSession / ChatMessage 有 workspace + user ownership 校验。
5. 多轮评估用例通过。
6. 不提交任何真实 `.env` / API key。
7. 生产部署前有数据库备份。
8. README / ARCHITECTURE / DEPLOYMENT 同步更新。

---

## 17. 推荐实施分支和提交节奏

建议新开分支：

```bash
git checkout feat/workspace-upload-pipeline
git pull
git checkout -b feat/d7-contextual-rag-ux
```

提交节奏：

```text
test(chat): add multi-turn regression fixture
feat(prisma): add chat session and message models
feat(chat): load server-side conversation history
feat(chat): condense follow-up questions
feat(rag): add knowledge base search tool
feat(chat): add guided fallback actions
feat(client): render chat action cards
feat(client): show workspace knowledge stats
refactor(app): unify upload and file management
docs: update d7 architecture and learning plan
```

---

## 18. 新会话第一条 Prompt

可以直接复制给新会话：

```text
请先阅读 docs/superpowers/handoffs/2026-09-29-d7-contextual-rag-and-ux-handoff.md，
再看当前源码：

server/src/chat
server/src/chat/rag
server/src/documents
client/src/features/chat
client/src/app/(dashboard)/chat
client/src/features/upload
client/src/app/(dashboard)/files
client/src/app/(dashboard)/upload

当前生产已部署 server:v10 / client:v7。
现在开始 D7 优化，不要重做 D1-D6 已完成能力。

按交接文档顺序实现：
1. 服务端 ChatSession / ChatMessage；
2. history + condenseQuestion；
3. 检索工具化 search_knowledge_base；
4. guided fallback 和 action cards；
5. Chat 页知识库状态条；
6. 上传页与文件管理页整合。

约束：
- 不破坏现有 SSE sources/delta/done/error；
- 不把 workspaceId 暴露给模型；
- 不让模型生成可点击 href；
- 不引入大而全 Agent 框架；
- 不直接部署生产；
- 先本地测试和 prod-like 验证。
```

---

## 19. 额外提醒

- 当前生产数据库已有备份，但优化涉及新 migration 前必须重新备份。
- 生产 `.env` 已补 RAG 变量，不要把值提交 Git。
- `/opt/cloud-storage/backups/` 中已有 Compose、`.env`、数据库备份。
- 如果要回滚应用，优先回滚 `server:v10` / `client:v7` 镜像，不要轻易回滚数据库。
- 上一轮截图中的“有 sources 但 fallback”正是本次 P0/P1 要解决的核心体验问题。
