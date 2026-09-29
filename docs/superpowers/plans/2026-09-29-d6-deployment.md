# D6 部署上线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the D1-D5 pgvector knowledge base and RAG chat system through a local production rehearsal and then the real `cloudstore.kxpwty.cn` environment.

**Architecture:** Build the committed server/client images, run a prod-like local stack with isolated volumes, then publish incremented image tags to Alibaba Cloud Registry. Deploy API and document-index worker together behind Next.js same-origin `/api` rewrites, migrate PostgreSQL after backup, and keep old tags for rollback.

**Tech Stack:** Next.js 14 standalone, NestJS 10, Prisma 5, PostgreSQL 16 + pgvector, Redis 7, BullMQ, MinIO/Qiniu, Docker Compose, Alibaba Cloud Container Registry.

**Spec:** [docs/superpowers/specs/2026-09-29-d6-deployment-design.md](../specs/2026-09-29-d6-deployment-design.md)

## Global Constraints

- Never commit real `.env`, API keys, storage keys, JWT secrets, or database passwords.
- Do not overwrite previously pushed image tags.
- Do not run production migration before a verified PostgreSQL backup.
- API and document-index worker must be deployed together.
- Production smoke must include upload/index, RAG SSE, citation validity, irrelevant fallback, and empty-workspace isolation.
- Keep rollback images and rollback commands available until release is accepted.

---

### Task 1: Freeze and publish the D5 release commit

**Files:**

- Modify: repository working tree only

**Interfaces:**

- Produces: release commit `926ab56 feat(rag): add pgvector knowledge base with SSE chat and evaluation`
- Produces: pushed branch `feat/workspace-upload-pipeline`

- [x] Run server tests, typecheck, and build.
- [x] Run client tests, typecheck, and build.
- [x] Scan staged changes for real secret patterns.
- [x] Commit D1-D5 source, migrations, evaluation assets, and compose changes.
- [x] Push `feat/workspace-upload-pipeline` to `github.com/kexiongpeng/cloudstore`.

### Task 2: Update product documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DEPLOYMENT.md`
- Create: `docs/superpowers/specs/2026-09-29-d6-deployment-design.md`
- Create: `docs/superpowers/plans/2026-09-29-d6-deployment.md`

**Interfaces:**

- Produces: public architecture diagram covering upload/index/RAG/SSE.
- Produces: operator-facing backup, migrate, deploy, smoke, and rollback steps.

- [x] Update README product scope, architecture, knowledge-base flow, commands, and production domain.
- [x] Update architecture document with pgvector, worker, RAG graph, SSE contract, and evaluation loop.
- [x] Update deployment document with RAG env vars, backup-first migration, smoke tests, and rollback.
- [x] Add D6 deployment design and implementation plan.
- [x] Commit documentation update.

### Task 3: Add local production rehearsal compose

**Files:**

- Create: `docker-compose.prod-local.yml`
- Create: `.env.prod-local.example`

**Interfaces:**

- Consumes: `server/Dockerfile`
- Consumes: `client/Dockerfile`
- Produces: frontend at `http://localhost:3101`
- Produces: optional API endpoint at `http://localhost:3200`
- Produces: internal services `nestjs:3000`, `postgres:5432`, `redis:6379`, `minio:9000`

- [x] Define isolated project name and volumes.
- [x] Build server/client from local Dockerfiles.
- [x] Run API and `server-worker` together.
- [x] Map only rehearsal ports; do not attach production shared proxy.
- [x] Provide MinIO bucket initialization.
- [x] Validate `docker compose config`.

### Task 4: Local production build and rehearsal

**Files:**

- Modify: none expected

**Interfaces:**

- Consumes: `docker-compose.prod-local.yml`
- Produces: verified local production stack

- [x] Copy `.env.prod-local.example` to a local untracked rehearsal env.
- [x] Build server and client production images.
- [x] Start the prod-local stack.
- [x] Run `prisma migrate deploy`.
- [x] Confirm API, worker, frontend, PostgreSQL, Redis, and MinIO health.
- [x] Upload a small Markdown file and wait for `indexed`.
- [x] Ask a relevant question and verify SSE `sources → delta → done`.
- [x] Verify citation numbers are within sources.
- [x] Ask an irrelevant question and verify fallback without citations.
- [x] Ask in an empty workspace and verify zero sources / fallback.
- [x] Fix any production-only issue and repeat until smoke passes.

### Task 5: Publish incremented release images

**Files:**

- Modify: `docker-compose.prod.yml`

**Interfaces:**

- Consumes: release commit and local rehearsal result
- Produces: pushed server image `v10` or higher
- Produces: pushed client image `v7` or higher

- [x] Choose unused server/client tags.
- [x] Build server image from release commit.
- [x] Build client image with `BACKEND_URL=http://nestjs:3000`.
- [ ] Push both images to Alibaba Cloud Registry (blocked by local Docker proxy; fallback used).
- [x] Update `docker-compose.prod.yml` image tags.
- [x] Commit image tag bump.

### Task 6: Back up and migrate production

**Files:**

- Modify: production `.env` outside Git

**Interfaces:**

- Consumes: production compose file
- Produces: timestamped `pg_dump` backup
- Produces: applied Prisma migrations

- [x] Verify required RAG/storage/JWT env vars exist without printing secrets.
- [x] Stop or quiesce API, worker, and frontend writes as appropriate.
- [x] Run `pg_dump` and verify the backup is non-empty.
- [x] Store the backup off-host (downloaded to `production-backups/`).
- [x] Run `prisma migrate deploy`.
- [x] Run `prisma migrate status` and ensure no pending migrations.

### Task 7: Deploy production services

**Files:**

- Modify: none expected beyond server compose checkout

**Interfaces:**

- Consumes: pushed images and completed migration
- Produces: running API, worker, frontend stack

- [x] Make images available on the VPS via `docker save` / `scp` / `docker load`.
- [x] Run `docker compose config` validation.
- [x] Start PostgreSQL and Redis first.
- [x] Start API, worker, and frontend.
- [x] Confirm container health / running status.
- [x] Inspect API, worker, and frontend logs.

### Task 8: Production smoke and acceptance

**Files:**

- Modify: none expected

**Interfaces:**

- Consumes: live production stack
- Produces: release acceptance evidence

- [x] Verify `https://cloudstore.kxpwty.cn` returns 200.
- [x] Verify `/api/auth/providers` returns JSON.
- [x] Log in with a production test account.
- [x] Upload smoke Markdown files and wait for `indexed`.
- [x] Run relevant RAG question and verify SSE and citations.
- [x] Run irrelevant question and verify fallback.
- [x] Run empty-workspace isolation question and verify no leakage.
- [x] Verify worker logs show completed document-index jobs.
- [x] Record release SHA, image tags, backup path, and smoke results.

### Task 9: Complete D6 documentation handoff

**Files:**

- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/ARCHITECTURE.md`

**Interfaces:**

- Produces: operator-ready deployment docs

- [ ] Ensure README links to architecture and deployment docs.
- [ ] Ensure architecture diagram reflects pgvector/RAG/worker topology.
- [ ] Ensure deployment runbook includes backup, migration, rollback, and smoke tests.
- [ ] Record any known issues or follow-up hardening tasks.

### Local Production Rehearsal Evidence

Date: 2026-09-29
Compose: `docker-compose.prod-local.yml`
Frontend: `http://localhost:3101`
Optional API: `http://localhost:3200`

Validation:

- `docker compose config` passed。
- 7 个 Prisma migrations 全部 applied。
- `prisma migrate status` 显示 schema up to date。
- Frontend returned 200，`/api/auth/providers` 通过 Next rewrite 返回 JSON。
- API healthcheck 通过后，worker 才启动。
- 上传 2 篇 Markdown 后均变为 indexed。
- RAG SSE 顺序为 `sources → delta... → done`。
- 多源检索返回 4 sources / 2 documents。
- citations `4,2,1,3` 均在 source range 内。
- 无关问题输出固定兜底。
- 空 workspace sources 为 0 且输出兜底。
- API-level smoke result: `pass=11/11 failures=0`。

Production-only issues found and fixed:

1. Production runner image omitted `tsconfig.json`, so `prisma:seed` failed. Added it to the server runner stage.
2. MinIO direct-upload URLs used the container-internal hostname. Added `MINIO_PUBLIC_ENDPOINT` for browser-reachable signed URLs while keeping `MINIO_ENDPOINT` for server-side S3 operations.
3. `GET /workspaces/:workspaceId/files` rejected omitted pagination query params. Replaced optional `ParseIntPipe` usage with explicit positive-integer validation and defaults.

### Production Deployment Evidence

Date: 2026-09-29  
Release branch: `feat/workspace-upload-pipeline`  
Compose release commit: `0a14c38 chore(deploy): release server v10 and client v7`  
Latest plan commit: deployed tree built from `0a14c38`  
Images: `server:v10`, `client:v7`

Production transfer note:

- ACR push was attempted three times but blocked by the local Docker proxy closing connections on a large server layer.
- Fallback used `docker save` → `scp` → `docker load`.
- Loaded image IDs matched local images for both server and client.

Production files:

- Active directory: `/opt/cloud-storage`
- Compose backup: `backups/docker-compose.prod.yml.20260929134227.bak`
- Pre-update env backup: `backups/.env.20260929134227.bak`
- Database backup on server: `backups/postgres-cloud_storage-20260929134628.sql`
- Off-host database backup: `production-backups/postgres-cloud_storage-20260929134628.sql`

Migration result:

- PostgreSQL image changed from `postgres:16` to `pgvector/pgvector:pg16`.
- The first pgvector migration failed because the old image did not contain the vector extension.
- After switching images, the failed migration was marked rolled back with `prisma migrate resolve --rolled-back 20260925000000_pgvector_text_embeddings`.
- `prisma migrate deploy` then applied all remaining migrations.
- Final `prisma migrate status`: database schema is up to date.

Production smoke result:

- Frontend HTTPS: 200。
- `/api/auth/providers`: 200, JSON。
- Login: configured production test account passed.
- Uploads: 2 Markdown files indexed.
- RAG SSE: `sources → delta... → done`.
- Multi-source retrieval: 4 sources / 2 documents.
- Citations: `4,2`, within source range.
- Irrelevant fallback: passed.
- Empty workspace: 0 sources, fallback, no leakage.
- API-level production smoke: `pass=11/11 failures=0`。
