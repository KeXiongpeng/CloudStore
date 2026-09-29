# D3 检索问答与 SSE 聊天侧栏设计

## 1. 背景与目标

D2 已完成 Markdown 切块、批量 Embedding、幂等导入和可溯源检索。D3 Step 1 已完成后端 `DocumentsController`，提供：

- `POST /api/documents/import`
- `POST /api/documents/search`

D3 Step 2–4 目标是把检索能力升级成用户可用的知识库问答：

- 用户提问后，后端先检索相关 Markdown chunk；
- 将检索片段组装进 prompt；
- 调用 LLM 流式生成回答；
- 后端通过 SSE 把引用来源、回答增量、完成或错误事件推给前端；
- 前端聊天页面流式渲染回答，并展示可溯源引用；
- 检索为空或生成失败时给出兜底与重试体验。

本设计按规划文档要求手写最小 agent loop 雏形，不引入 LangGraph、LangChain、Dify 或其他编排框架。

## 2. 范围

### 2.1 本次范围

- 新增后端 chat 模块。
- 新增 `POST /api/chat` SSE 接口。
- 新增 LLM 流式调用服务。
- 新增前端聊天页面和 SSE 解析能力。
- 侧边栏新增「知识库问答」入口。
- 覆盖检索为空、LLM 失败、用户停止生成三种体验。
- 补充后端和前端自动化测试。

### 2.2 暂不做

- 不做会话历史持久化。
- 不做多轮上下文记忆。
- 不做 query 重写、相关性判断、rerank。
- 不做引用点击后自动定位文件内容。
- 不做消息收藏、导出、评价打分。
- 不做生产部署。
- 不执行 git commit / git push。

这些能力留给 D4 及后续迭代。

## 3. 技术决策

| 决策         | 选择                                           | 原因                                                             |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------- |
| Agent 框架   | 不引入                                         | D3 目标是理解检索 → prompt → 生成的基本链路                      |
| LLM API      | SiliconFlow OpenAI-compatible Chat Completions | 复用现有 SiliconFlow key 和调用方式                              |
| 默认模型     | `deepseek-ai/DeepSeek-V3`                      | 与交接文档中 DeepSeek / SiliconFlow 方向一致，可通过环境变量替换 |
| 流式协议     | SSE                                            | 后端到前端单向增量输出，协议简单                                 |
| 前端读取方式 | `fetch` + `ReadableStream`                     | 后端使用 POST body，`EventSource` 只支持 GET，不适合             |
| 状态管理     | React state                                    | 当前聊天是页面局部状态，无跨页共享需求                           |
| 新增后端依赖 | 无                                             | `@nestjs/axios`、RxJS、Node stream 已足够                        |
| 新增前端依赖 | 无                                             | `fetch`、React、Tailwind 已足够                                  |

## 4. 环境变量

新增配置：

```env
LLM_API_URL=https://api.siliconflow.cn/v1/chat/completions
LLM_MODEL=deepseek-ai/DeepSeek-V3
LLM_MAX_TOKENS=1024
LLM_TEMPERATURE=0.2
```

复用现有：

```env
SILICONFLOW_API_KEY
```

配置约束：

- `SILICONFLOW_API_KEY` 必须存在，否则启动或调用时明确报错。
- `LLM_API_URL` 必须是合法 URI。
- `LLM_MAX_TOKENS` 必须是正整数。
- `LLM_TEMPERATURE` 必须在 `0` 到 `2` 之间。
- 不把模型名、URL、key 写死在业务代码里。

## 5. 后端架构

### 5.1 模块结构

新增目录：

```text
server/src/chat/
├── chat.controller.ts
├── chat.service.ts
├── chat.module.ts
├── llm.service.ts
└── dto/
    └── ask-question.dto.ts
```

职责边界：

| 文件               | 职责                                         |
| ------------------ | -------------------------------------------- |
| `ChatController`   | 参数校验、设置 SSE headers、写 SSE 响应      |
| `ChatService`      | 检索、组装 prompt、组织事件流、兜底逻辑      |
| `LlmService`       | 调用 OpenAI-compatible 流式 API 并解析 delta |
| `DocumentsService` | 只负责向量检索，不感知聊天逻辑               |
| `AskQuestionDto`   | 校验 `question` 和 `limit`                   |

`AppModule` 注册 `ChatModule`。`ChatModule` imports：

- `HttpModule`
- `DocumentsModule`

### 5.2 API 定义

```http
POST /api/chat
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: text/event-stream
```

请求体：

```json
{
  "question": "pgvector 为什么使用余弦距离？",
  "limit": 5
}
```

字段规则：

| 字段       | 类型   | 必填 | 规则         |
| ---------- | ------ | ---- | ------------ |
| `question` | string | 是   | 长度 1–1000  |
| `limit`    | int    | 否   | 1–10，默认 5 |

成功响应：

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

接口需要 JWT 登录。学习项目暂不按 workspace 隔离知识库文档；后续如果知识库接入工作区，再增加 workspace scope。

### 5.3 SSE 事件协议

统一使用 named event，不使用匿名 event。

#### sources

检索完成后立刻发送一次：

```text
event: sources
data: {"sources":[{"chunkId":"...","documentId":"...","title":"D2 交接文档","sourcePath":"uploads/D2.md","headingPath":["D2","3. 数据模型"],"chunkIndex":2,"content":"...","similarity":0.81}]}
```

#### delta

每收到 LLM 增量文本就发送：

```text
event: delta
data: {"content":"pgvector 使用"}
```

#### done

正常完成后发送：

```text
event: done
data: {"done":true}
```

#### error

失败时发送：

```text
event: error
data: {"message":"生成失败，请稍后重试"}
```

规则：

- `sources` 事件最多发送一次。
- 正常结束时最后一个是 `done`。
- 失败时发送 `error`，不再发送 `done`。
- SSE `data` 必须是单行 JSON。
- 不把原始 API key、完整 prompt 或上游错误堆栈发给前端。
- 用户主动停止请求时，后端检测到客户端断开后停止迭代，不再继续向已断开连接写数据。

## 6. 检索与 Prompt 设计

### 6.1 检索

`ChatService` 调用：

```ts
const sources = await documentsService.search(question, limit);
```

检索结果已经包含：

- `chunkId`
- `documentId`
- `title`
- `sourcePath`
- `headingPath`
- `chunkIndex`
- `content`
- `similarity`

### 6.2 兜底

如果 `sources.length === 0`：

1. 不调用 LLM；
2. 发送空 `sources`；
3. 直接发送一段固定兜底 `delta`；
4. 发送 `done`。

兜底文案：

```text
知识库中没有找到足够相关的资料，暂时无法回答这个问题。你可以换个说法，或先导入相关 Markdown 文档。
```

### 6.3 Prompt 组装

System prompt：

```text
你是一个严格基于知识库资料回答问题的助手。

规则：
1. 只使用用户提供的资料回答问题。
2. 如果资料不足以回答，直接说明知识库中没有足够相关信息。
3. 回答使用简体中文。
4. 回答要简洁、准确、可执行。
5. 引用资料时使用 [1]、[2] 这样的编号。
6. 不要编造资料中不存在的内容。
```

User prompt 结构：

```text
知识库资料：

[1]
标题：D2 交接文档
位置：D2 交接文档 > 3. 数据模型
来源：uploads/D2.md
chunkIndex：2
内容：
...

[2]
标题：本地 pgvector 环境
位置：本地 pgvector 环境 > 2. 注意事项
来源：uploads/local-pgvector.md
chunkIndex：0
内容：
...

用户问题：
pgvector 为什么使用余弦距离？
```

要求：

- 检索片段编号从 `[1]` 开始。
- 每个片段必须带标题、位置、来源、chunkIndex。
- 超长片段不再二次裁剪，继续依赖 D2 chunk 预算。
- `limit` 默认 5，最大 10，避免 prompt 失控。

### 6.4 引用展示

前端展示后端返回的 `sources`，包括：

- 标题；
- headingPath；
- chunkIndex；
- sourcePath；
- 相似度。

前端不依赖解析回答文本中的 `[1]` 来生成引用列表，而是以后端 `sources` 事件为准。

## 7. LLM 调用设计

### 7.1 请求

`LlmService.streamChat(messages)` 调用：

```http
POST ${LLM_API_URL}
Authorization: Bearer ${SILICONFLOW_API_KEY}
Content-Type: application/json
```

请求体：

```json
{
  "model": "deepseek-ai/DeepSeek-V3",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "stream": true,
  "max_tokens": 1024,
  "temperature": 0.2
}
```

### 7.2 流式解析

上游返回 OpenAI-compatible SSE：

```text
data: {"choices":[{"delta":{"content":"pgvector"}}]}

data: {"choices":[{"delta":{"content":" 使用"}}]}

data: [DONE]
```

解析规则：

- 只处理以 `data:` 开头的行；
- 忽略空行、注释和无法解析的 keep-alive；
- `data: [DONE]` 表示结束；
- `choices[0].delta.content` 存在且非空时向外 yield；
- 上游返回错误事件或异常 HTTP 状态时抛出统一错误。

### 7.3 重试

只对以下情况做一次重试：

- 网络连接失败；
- HTTP 408；
- HTTP 429；
- HTTP 500 / 502 / 503 / 504。

不重试：

- 用户主动取消；
- 400 参数错误；
- 401 / 403 key 或权限错误；
- 已经输出过 delta 后又中断的流。

重试失败时，后端发送 SSE `error`。

## 8. 前端架构

### 8.1 页面与入口

新增页面：

```text
client/src/app/(dashboard)/chat/page.tsx
```

侧边栏 `Sidebar.tsx` 增加入口：

```text
/chat 知识库问答 🧠
```

页面仅登录用户可访问，依赖现有 dashboard 布局。

### 8.2 文件结构

```text
client/src/features/chat/
├── api.ts
├── types.ts
├── sse.ts
└── ChatPanel.tsx
```

职责：

| 文件            | 职责                                                      |
| --------------- | --------------------------------------------------------- |
| `api.ts`        | 发起 `POST /api/chat`，携带 access token，交给 SSE parser |
| `sse.ts`        | 解析 SSE named event 和 data JSON                         |
| `types.ts`      | 定义 `ChatSource`、stream event、chat message 类型        |
| `ChatPanel.tsx` | 输入、状态、流式回答、引用列表、停止和重试                |
| `page.tsx`      | dashboard 内挂载 `ChatPanel`                              |

### 8.3 前端状态

```ts
type ChatStatus = 'idle' | 'searching' | 'generating' | 'done' | 'error';
```

一次提问的状态流：

```text
idle
→ searching：已发送请求，等待 sources
→ generating：已收到 sources，正在接收 delta
→ done：收到 done
→ error：收到 error、请求失败或用户中止异常
```

### 8.4 交互

- 输入框支持 Enter 发送。
- `Shift + Enter` 换行。
- 发送期间禁用发送按钮。
- 生成期间显示「停止生成」。
- 失败后显示「重试」。
- 回答区域自动滚动到底部。
- 引用列表始终显示后端返回的真实来源。
- 检索为空时展示兜底文案。
- 当前学习版只保留最近一次问答，不做多轮历史。

### 8.5 样式

继续使用 Tailwind，遵循现有 dashboard 的浅色/深色变量风格。

最小可用界面：

- 顶部标题「知识库问答」；
- 回答和引用区域；
- 底部固定输入区；
- 移动端可用；
- 不做复杂动画。

## 9. 错误处理

| 场景                   | 后端行为                           | 前端行为                 |
| ---------------------- | ---------------------------------- | ------------------------ |
| question 为空或超长    | HTTP 400                           | 不发请求，本地校验提示   |
| limit 非法             | HTTP 400                           | 不发请求，本地校验提示   |
| 未登录                 | HTTP 401                           | 引导登录                 |
| 检索为空               | 发送空 sources + 兜底 delta + done | 展示兜底话术             |
| LLM 请求失败且重试失败 | 发送 error                         | 展示失败原因和重试       |
| LLM key 无效           | 不重试，发送 error                 | 提示服务端模型配置异常   |
| 生成中断               | 停止向上游迭代，停止写响应         | 状态改为 idle 或 stopped |
| 客户端断开             | 停止迭代并清理资源                 | 无                       |

错误消息对用户可读，不暴露上游完整响应和密钥。

## 10. 测试设计

### 10.1 后端单元测试

`ChatService`：

- 检索为空时不调用 LLM；
- 检索为空时发送兜底 delta 和 done；
- 有资料时按 `[1]`、`[2]` 组装片段；
- prompt 包含 system 规则、来源、headingPath 和用户问题；
- LLM delta 依次转发；
- 正常结束发送 done；
- LLM 失败发送 error；
- sources 字段完整透传。

`ChatController`：

- 设置 SSE headers；
- 按顺序写 `sources`、`delta`、`done`；
- 异常时写 `error` 并结束响应。

`LlmService`：

- 解析 OpenAI-compatible delta；
- `[DONE]` 后停止；
- 忽略空行和非法行；
- 上游错误抛出统一错误。

`AskQuestionDto`：

- question 必填；
- question 最大 1000；
- limit 默认 5；
- limit 范围 1–10。

### 10.2 前端测试

`sse.ts`：

- 能解析 named event；
- 能解析 JSON data；
- 多个 delta 按顺序返回；
- 不完整 buffer 等待下一段；
- 非法 JSON 不导致整次解析崩溃。

`ChatPanel`：

- 初始渲染输入框；
- 提交后进入 searching；
- sources 到达后进入 generating；
- delta 按顺序追加；
- done 后结束 loading；
- error 后显示错误和重试；
- 检索为空显示兜底文案。

### 10.3 集成自测

后端：

- Swagger 或 curl 带 JWT 调 `POST /api/chat`；
- 验证 `Content-Type: text/event-stream`；
- 观察事件顺序为 `sources → delta → done`；
- 用已有文档问题验证回答含引用；
- 用无答案问题验证兜底；
- 模拟错误验证 error。

前端：

- `vitest`、Next build 通过；
- 登录后从侧边栏进入 `/chat`；
- 发送已有文档问题，验证流式输出和引用；
- 发送无答案问题，验证兜底；
- 验证停止生成和重试按钮。

### 10.4 验收标准

D3 Step 2–4 完成必须同时满足：

1. `POST /api/chat` 使用 JWT，返回 SSE。
2. 事件顺序符合 `sources → delta → done`。
3. 引用来源来自 `DocumentsService.search()`，包含 sourcePath、headingPath、chunkIndex。
4. 回答内容由 LLM 流式生成。
5. 前端 `/chat` 能流式显示回答。
6. 前端能显示真实引用来源。
7. 检索为空时不调用 LLM 并显示兜底。
8. LLM 失败时前端可见错误并可重试。
9. 用户可停止生成。
10. 后端测试、前端测试、typecheck、build 全部通过。
11. 不执行 git commit / git push / 部署。

## 11. 风险与后续迭代

| 风险             | 处理                                                   |
| ---------------- | ------------------------------------------------------ |
| LLM 忽略引用规则 | prompt 强约束；D4 加入相关性判断和 query 重写          |
| 检索片段不相关   | 当前依赖相似度排序；D4/评估阶段引入 rerank 或阈值      |
| SSE 被代理缓冲   | 后端设置 `X-Accel-Buffering: no`；本地开发不经过 Nginx |
| LLM 输出过长     | `LLM_MAX_TOKENS` 限制                                  |
| key 泄漏         | key 只在服务端读取，不返回给前端                       |
| 多轮上下文复杂   | 本次明确不做，后续单独设计会话模型                     |

后续迭代方向：

1. 多轮会话历史；
2. 引用点击定位原文；
3. workspace 级知识库隔离；
4. 相关性阈值；
5. rerank；
6. 20 题评估集；
7. query 重写与条件路由。
