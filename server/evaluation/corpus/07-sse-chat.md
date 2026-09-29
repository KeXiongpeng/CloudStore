# SSE 聊天协议

## 事件类型

聊天接口使用四个 named SSE 事件：`sources`、`delta`、`done` 和 `error`。每个事件的 JSON 载荷保持稳定，前端不依赖未定义字段。

## 正常顺序

正常回答的事件顺序是先发送一次 `sources`，然后发送多个 `delta`，最后发送 `done`。引用列表在正文开始前到达，方便用户先看到来源。

## 错误顺序

检索失败时只发送 `error`。生成失败时可能已经发送 `sources` 和部分 `delta`，然后发送 `error`；`error` 之后不会再补发 `done`。
