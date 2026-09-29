# D3 RAG Chat SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build the D3 retrieval-augmented chat flow: backend retrieval + prompt assembly + streaming LLM + SSE, and a dashboard chat UI with citations, fallback, stop, retry, and error handling.

**Architecture:** Add a standalone NestJS `ChatModule` that composes the existing `DocumentsService.search()` with a new OpenAI-compatible `LlmService`. The controller writes named SSE events (`sources`, `delta`, `done`, `error`) directly to the response so the global response envelope does not interfere. The Next.js dashboard page uses `fetch` + `ReadableStream` because the endpoint is POST and `EventSource` only supports GET.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, pgvector, SiliconFlow OpenAI-compatible chat API, Next.js 14, React 18, Tailwind CSS, Vitest, Jest.

**Spec:** `docs/superpowers/specs/2026-09-26-d3-rag-chat-sse-design.md`

## Global Constraints

- Do not run `git commit`, `git push`, `docker compose push`, or deployment commands.
- Do not add new backend or frontend package dependencies.
- Preserve existing D1/D2 behavior.
- Use existing JWT guard pattern for chat.
- SSE named event order on success: `sources` → `delta` → `done`.
- SSE failure uses `error`; do not emit `done` after `error`.
- Retrieval-empty requests must not call the LLM.
- Do not expose API keys, raw upstream payloads, prompts, or stack traces to the client.
- User-facing answer language is Simplified Chinese.
- All final claims require fresh command evidence: server Jest, server typecheck, server build, client Vitest, client typecheck/build.

---

### Task 1: Configuration and Ask DTO

**Files:**

- Modify: `server/src/common/config/configuration.ts`
- Modify: `server/.env`
- Modify: `server/.env.example`
- Create: `server/src/chat/dto/ask-question.dto.ts`
- Create: `server/src/chat/dto/ask-question.dto.spec.ts`

**Interfaces:**

- Produces: `AskQuestionDto { question: string; limit?: number }`, validated to `question: 1..1000`, `limit: 1..10`.
- Produces config keys: `llm.apiUrl`, `llm.model`, `llm.maxTokens`, `llm.temperature`, plus existing `embedding.apiKey`.

- [x] Write failing DTO validation tests.
- [x] Run targeted tests and confirm red.
- [x] Implement DTO validators and LLM config/schema entries.
- [x] Add local/example environment keys without replacing the existing key.
- [x] Run targeted tests and confirm green.

### Task 2: LLM SSE Client

**Files:**

- Create: `server/src/chat/llm.service.ts`
- Create: `server/src/chat/llm.service.spec.ts`

**Interfaces:**

- Consumes: `HttpService`, `ConfigService`.
- Produces: `LlmService.streamChat(messages: ChatMessage[]): AsyncGenerator<string>`.
- Produces: exported `ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }`.

- [x] Write failing tests for delta parsing, `[DONE]`, ignored blank/invalid lines, and upstream failure.
- [x] Run targeted tests and confirm red.
- [x] Implement stream request and async line/delta parser.
- [x] Run targeted tests and confirm green.

### Task 3: Chat Service and Prompt/Fallback

**Files:**

- Create: `server/src/chat/chat.service.ts`
- Create: `server/src/chat/chat.service.spec.ts`

**Interfaces:**

- Consumes: `DocumentsService.search(question, limit): Promise<TraceableSearchResult[]>`.
- Consumes: `LlmService.streamChat(messages): AsyncGenerator<string>`.
- Produces: `ChatService.answerStream(question, limit): AsyncGenerator<ChatStreamEvent>`.
- Produces event union: `sources | delta | done | error`.

- [x] Write failing tests for empty retrieval, prompt citation assembly, delta forwarding, and error event.
- [x] Run targeted tests and confirm red.
- [x] Implement retrieval, prompt, fallback, event stream, and safe error message handling.
- [x] Run targeted tests and confirm green.

### Task 4: SSE Controller and Module

**Files:**

- Create: `server/src/chat/chat.controller.ts`
- Create: `server/src/chat/chat.controller.spec.ts`
- Create: `server/src/chat/chat.module.ts`
- Modify: `server/src/app.module.ts`

**Interfaces:**

- Consumes: `ChatService.answerStream`.
- Produces: `POST /api/chat`, protected by `JwtAuthGuard`, response `text/event-stream`.

- [x] Write failing controller tests for headers, named event order, and error handling.
- [x] Run targeted tests and confirm red.
- [x] Implement controller direct-response SSE writer and module registration.
- [x] Run targeted server tests and confirm green.

### Task 5: Frontend SSE Parser

**Files:**

- Create: `client/src/features/chat/types.ts`
- Create: `client/src/features/chat/sse.ts`
- Create: `client/src/features/chat/sse.test.ts`

**Interfaces:**

- Produces: `parseSseStream(stream: ReadableStream<Uint8Array>, onEvent: (event: ChatSseEvent) => void): Promise<void>`.
- Produces: typed `sources`, `delta`, `done`, and `error` events.

- [x] Write failing parser tests for named events, split chunks, incomplete buffer, and invalid JSON.
- [x] Run client tests and confirm red.
- [x] Implement decoder/buffer/parser.
- [x] Run client tests and confirm green.

### Task 6: Frontend API and Chat Panel

**Files:**

- Create: `client/src/features/chat/api.ts`
- Create: `client/src/features/chat/ChatPanel.tsx`
- Create: `client/src/features/chat/ChatPanel.test.tsx`
- Create: `client/src/app/(dashboard)/chat/page.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/package.json` only if existing dev tooling already supports component tests; otherwise limit UI logic tests to parser/api and verify UI manually/build.

**Interfaces:**

- Consumes: `parseSseStream`.
- Consumes: access token from `client/src/lib/auth.ts`.
- Produces: dashboard route `/chat`.

- [x] Implement POST fetch API with abort/token/JSON handling.
- [x] Implement chat panel states: idle, searching, generating, done, error.
- [x] Render streamed answer and citation list from `sources`.
- [x] Add stop generation and retry controls.
- [x] Add sidebar and page entry.
- [x] Add component tests only if existing test setup supports them without new dependencies; otherwise add pure logic tests and verify UI by build/manual smoke.

### Task 7: Write-back and Full Verification

**Files:**

- Verify all files above.

- [x] Read back key source and test anchors; ensure UTF-8 no BOM.
- [x] Run full backend Jest.
- [x] Run backend typecheck and build.
- [x] Run frontend Vitest.
- [x] Run frontend typecheck/build.
- [x] Start backend and perform local real SSE smoke with JWT.
- [x] Start/verify client and leave services available for user functional testing.
- [x] Confirm no commit/push/deploy was executed.
