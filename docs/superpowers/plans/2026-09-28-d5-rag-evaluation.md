# D5 RAG Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a repeatable 20-case RAG evaluation runner that records retrieval, answer, citation, fallback, rewrite, latency, and workspace isolation metrics, then emits JSON and Markdown reports.

**Architecture:** Reuse the production `RagGraphService` state graph instead of copying RAG logic. Expose the graph's final state without changing the SSE contract. Add an isolated evaluation module with a deterministic eval set, an independent LLM answer judge, pure metric/report builders, and a Nest application-context CLI.

**Tech Stack:** NestJS 10, TypeScript strict, LangGraph StateGraph, Prisma/PostgreSQL + pgvector, DeepSeek-compatible Chat Completions, ts-node CLI, Jest.

**Spec:** Chat-approved D5 design, 2026-09-28; current D4/D5 handover docs.

## Global Constraints

- Do not run `git commit`, `git push`, `docker compose push`, or deploy.
- Do not change `ChatStreamEvent` names or payloads: `sources`, `delta`, `done`, `error`.
- Do not alter citation numbering: final sources array, prompt citations, frontend citations stay aligned.
- Never log or write API keys or complete upstream response bodies.
- Evaluation runs sequentially; one case failure must not stop the run.
- The baseline corpus and model settings must not change after baseline preflight.
- Answer judge parse failure produces `answerCorrectness: null` and `judgeError`; it never fails the runner.

## File Structure

- Modify `server/src/chat/rag/rag-state.ts`: add `retrieveCount`.
- Modify `server/src/chat/rag/rag-graph.factory.ts`: export fallback text and increment `retrieveCount`.
- Modify `server/src/chat/rag/rag-graph.service.ts`: return the graph final state.
- Modify `server/src/chat/llm.service.ts`: allow complete() to override temperature only.
- Create `server/src/evaluation/evaluation.types.ts`: eval-set/report types.
- Create `server/src/evaluation/rag-eval-set.ts`: 20 deterministic cases.
- Create `server/src/evaluation/source-metrics.ts`: pure source/citation/fallback metrics.
- Create `server/src/evaluation/rag-answer-judge.service.ts`: strict JSON answer judge.
- Create `server/src/evaluation/rag-evaluation.service.ts`: preflight, case execution, orchestration.
- Create `server/src/evaluation/rag-report.service.ts`: aggregate metrics, JSON + Markdown.
- Create `server/src/evaluation/evaluation.module.ts`: Nest DI module.
- Create `server/src/evaluation/rag-evaluation.cli.ts`: CLI entry.
- Create corpus under `server/evaluation/corpus/`; reports under `server/evaluation/reports/`.

---

### Task 1: Expose graph execution telemetry

- [x] Add `retrieveCount` to `RagGraphState`, default 0.
- [x] Increment it once per retrieve node execution and return final state from `RagGraphService.run()`.
- [x] Export `NO_RELEVANT_SOURCE_FALLBACK`.
- [x] Update/extend chat graph tests to assert first retrieve=1, rewrite+second retrieve=2.
- [x] Run `npm.cmd run test -- --runInBand src/chat`, `npm.cmd run typecheck`.

### Task 2: Add eval types and pure metrics

- [x] Define behavior, expected facts/source paths, raw result, evaluated case, report types.
- [x] Implement heading path matching, Hit@1/@3, MRR, source coverage, citation validation, fallback correctness, workspace leak.
- [x] Tests cover correct answer, multi-source partial hit, invalid/out-of-range/missing citation, fallback with no citations, empty-workspace leak, and retrieval metric exclusion for fallback cases.
- [x] Run focused Jest and typecheck.

### Task 3: Add stable 20-case eval set

- [x] Encode the approved 20 cases exactly: 6 single-source, 4 multi-source, 4 colloquial, 4 irrelevant, 2 isolation.
- [x] Validate all required expected fields and workspace labels in a unit test.
- [x] Run focused Jest and typecheck.

### Task 4: Add answer judge

- [x] Extend `LlmService.complete(messages, options?)` with `{ temperature?: number }`; preserve existing callers.
- [x] Implement `RagAnswerJudgeService.judge()` with strict JSON, temperature 0, score 0/1/2, missingPoints, hallucination, reason.
- [x] Tests cover valid JSON, fenced JSON, invalid JSON returning null plus judgeError, and judge failure isolation.
- [x] Run focused Jest and typecheck.

### Task 5: Implement evaluation service

- [x] Preflight Workspace A active + exactly the 8 expected indexed docs; Workspace B active + zero documents.
- [x] Execute cases sequentially using `RagGraphService`, an `AsyncEventQueue`, and the same state initialization as production chat.
- [x] Collect events, answer, sources, final state, latency, behavior, and safe errors; continue after any case failure.
- [x] Map fallback by exported fallback text; error cases do not invoke answer judge.
- [x] Tests cover answer collection, fallback, error continuation, rewrite retrieval count, and preflight failures.
- [x] Run focused Jest and typecheck.

### Task 6: Generate reports and CLI

- [x] Aggregate pass rate, answer-only Hit@3/MRR/source coverage, fallback correctness, workspace leak, judge/error/rewrite/latency metrics.
- [x] Emit deterministic Markdown sections: Summary, Baseline Freeze, Failure Summary, Per-case Result, Next Optimization Hypothesis, Limitations.
- [x] Write JSON and Markdown under `server/evaluation/reports/` with timestamped names.
- [x] CLI parses `--label`, `--workspace-a`, `--workspace-b`, `--case-delay-ms`; validates IDs, runs preflight, evaluates, closes Nest context, and prints safe progress only.
- [x] Register `rag:evaluate`.
- [x] Tests cover aggregate/report and CLI option validation.
- [x] Run focused Jest and typecheck.

### Task 7: Add frozen corpus

- [x] Create the eight approved Markdown docs with stable headings and concise factual content.
- [x] Corpus covers HNSW, pgvector, cosine distance, embedding, upload/index, markdown chunking, SSE, StateGraph.
- [x] Add `server/evaluation/README.md` with upload, workspace, and runner instructions.
- [x] Run all server and client checks: tests, typecheck, build.

### Task 8: Baseline run gate

- [x] Confirm services and migrations.
- [x] Upload corpus once to dedicated Workspace A; ensure Workspace B is empty; wait until all eight docs are indexed.
- [x] Run `npm.cmd run rag:evaluate -- --label rag-baseline --workspace-a <A_ID> --workspace-b <B_ID>`.
- [x] Review JSON + Markdown; do not optimize until baseline is reviewed.
