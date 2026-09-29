# StateGraph RAG

## 图节点

LangGraph StateGraph 中的 RAG 图包含 `retrieve`、`judge`、`rewriteQuery`、`generate` 和 `fallback`。每个节点只返回 partial state，由图负责合并。

## 条件路由

`retrieve` 后根据错误状态进入 `judge` 或结束。`judge` 后根据相关性进入 `generate`、`rewriteQuery` 或 `fallback`。rewrite 成功后才允许再次检索。

## 重写预算

当前图设置 `maxRewrites = 1`。也就是说最多一次 query rewrite，最多两次向量检索，避免模型判断抖动导致无限循环。
