# Unified Upload Index and Chat Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make unified workspace uploads the only entry point for searchable knowledge, process supported files asynchronously, scope retrieval to the current workspace, and persist multiple chat sessions locally.

**Architecture:** Upload completion remains the sole ingestion trigger. Supported files enqueue a BullMQ document-index job; the worker downloads the stored object, extracts text, chunks it, creates embeddings, and replaces the document's chunks. `Document` gains workspace/file/version/index-status links. Chat search filters by workspace and `indexed` documents. Chat UI sessions are persisted per user in `localStorage`.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16 + pgvector, BullMQ, MinIO/S3, pdfjs-dist, SiliconFlow Embeddings, Next.js 14, React 18, Tailwind, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-d3-rag-chat-sse-design.md` plus the user-approved unified upload architecture.

## Global Constraints

- Do not commit, push, or deploy.
- No new npm dependency; `pdfjs-dist` is already installed.
- Upload remains the only knowledge entry point.
- Unsupported binary files are stored but not indexed.
- Chat retrieval must filter by current workspace and indexed documents only.
- Deleting a workspace file must remove/disable its indexed chunks.
- Do not print presigned URLs with signatures in logs.
- Preserve existing chat SSE contract: `sources` → `delta` → `done`; `error` on failure.
- Empty files remain rejected with a clear user-facing message.
- All completion claims require fresh backend/client tests, typecheck, and builds.

---

### Task 1: Data Model and Migration

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/20260926220000_unified_document_index/migration.sql`

- [x] Add `DocumentIndexStatus`: `pending`, `processing`, `indexed`, `failed`.
- [x] Add nullable `workspaceId`, `fileId`, `fileVersionId`, `indexStatus`, `indexedAt`, `indexError` to `Document`.
- [x] Add relations Workspace/File/FileVersion with cascade removal.
- [x] Keep `sourcePath` stable per file as `workspace-file:<fileId>`.
- [x] Generate/apply migration and regenerate Prisma Client.

### Task 2: Text Extraction and Chunking

**Files:**

- Create: `server/src/documents/text-chunker.ts`
- Create: `server/src/documents/text-chunker.spec.ts`
- Create: `server/src/documents/text-extractor.ts`
- Create: `server/src/documents/text-extractor.spec.ts`

- [x] Implement paragraph chunking for txt/PDF text with overlap.
- [x] Implement UTF-8 md/txt extraction.
- [x] Implement PDF text-layer extraction using existing `pdfjs-dist`.
- [x] Return empty-text errors instead of indexing empty content.
- [x] Unit-test md, txt, PDF text, and empty extraction behavior.

### Task 3: Document Index Queue and Worker

**Files:**

- Modify: `server/src/queue/queue.service.ts`
- Modify: `server/src/queue/queue.module.ts`
- Create: `server/src/documents/document-index.service.ts`
- Create: `server/src/documents/document-index.service.spec.ts`
- Create: `server/src/queue/processors/document-index.processor.ts`
- Modify: `server/src/documents/documents.module.ts`

- [x] Add BullMQ `document-index` queue/job data.
- [x] Implement processor service: download object → extract → chunk → batch embeddings → replace chunks in a transaction.
- [x] Transition status `pending → processing → indexed`; failures → `failed` with safe error.
- [x] Skip unchanged extracted content when version is unchanged.
- [x] Start worker in existing QueueModule.

### Task 4: Upload Completion Trigger and Index Status API

**Files:**

- Modify: `server/src/upload/upload.service.ts`
- Modify: `server/src/files/workspace-files.service.ts`
- Modify: `server/src/files/workspace-files.controller.ts`

- [x] On successful upload completion, create pending Document and enqueue indexing for `.md`, `.txt`, `.pdf`.
- [x] Unsupported files are stored normally and do not create a Document.
- [x] File list serializer exposes `indexStatus`, `indexedAt`, and `indexError`.
- [x] File deletion removes the linked Document and cascades chunks.
- [x] Add a reindex endpoint for future/version use.

### Task 5: Workspace-Scoped Retrieval and Chat

**Files:**

- Modify: `server/src/documents/documents.service.ts`
- Modify: `server/src/chat/chat.service.ts`
- Modify: `server/src/chat/chat.controller.ts`
- Modify: `server/src/chat/dto/ask-question.dto.ts`
- Modify tests accordingly.

- [x] Add workspace filter to vector SQL.
- [x] Require `workspaceId` in chat request and validate UUID.
- [x] Only search `Document.indexStatus = indexed`.
- [x] Return traceability fields from unified files.

### Task 6: File List Index Badges

**Files:**

- Modify: `client/src/components/FileCard.tsx`
- Modify: `client/src/components/FileRow.tsx`
- Modify: `client/src/features/chat/types.ts` if shared types needed.

- [x] Add knowledge index status type/labels/colors.
- [x] Display pending/processing/indexed/failed/unsupported states.
- [x] Show retry-free error text for failed indexing.

### Task 7: Frontend Workspace Chat Request

**Files:**

- Modify: `client/src/features/chat/api.ts`
- Modify: `client/src/features/chat/ChatPanel.tsx`
- Modify tests.

- [x] Send current workspace ID with each question.
- [x] Prevent sending before workspace selection.
- [x] Show a clear workspace-specific empty result message.
- [x] Keep SSE bubble lifecycle intact.

### Task 8: Chat Session Persistence

**Files:**

- Create: `client/src/features/chat/session-storage.ts`
- Create: `client/src/features/chat/session-storage.test.ts`
- Modify: `client/src/features/chat/conversation.ts`
- Modify: `client/src/features/chat/conversation.test.ts`
- Modify: `client/src/features/chat/ChatPanel.tsx`

- [x] Store multiple sessions per logged-in user in localStorage.
- [x] Sanitize persisted messages; in-flight statuses become stopped after reload.
- [x] Restore active session and list on refresh/page switch.
- [x] Auto-title from first user message.
- [x] Support new session, session switch, and clear active session.
- [x] Namespace storage by user ID and schema version.

### Task 9: Verification

- [x] Read back migration/model/index/worker/session anchors and ensure no BOM.
- [x] Run backend Jest, typecheck, build.
- [x] Run frontend Vitest, typecheck, build.
- [x] Apply migration to local DB.
- [x] Restart API/worker and upload unique `.txt`, `.md`, `.pdf`.
- [x] Verify upload status becomes indexed and chat returns workspace-scoped answer.
- [x] Verify deleting a file removes it from retrieval.
- [x] Verify refresh/page switch preserves sessions.
