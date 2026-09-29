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
- [ ] Push `feat/workspace-upload-pipeline` to `github.com/kexiongpeng/cloudstore`.

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
- [ ] Commit documentation update.

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

- [ ] Define isolated project name and volumes.
- [ ] Build server/client from local Dockerfiles.
- [ ] Run API and `server-worker` together.
- [ ] Map only rehearsal ports; do not attach production shared proxy.
- [ ] Provide MinIO bucket initialization.
- [ ] Validate `docker compose config`.

### Task 4: Local production build and rehearsal

**Files:**

- Modify: none expected

**Interfaces:**

- Consumes: `docker-compose.prod-local.yml`
- Produces: verified local production stack

- [ ] Copy `.env.prod-local.example` to a local untracked rehearsal env.
- [ ] Build server and client production images.
- [ ] Start the prod-local stack.
- [ ] Run `prisma migrate deploy`.
- [ ] Confirm API, worker, frontend, PostgreSQL, Redis, and MinIO health.
- [ ] Upload a small Markdown file and wait for `indexed`.
- [ ] Ask a relevant question and verify SSE `sources → delta → done`.
- [ ] Verify citation numbers are within sources.
- [ ] Ask an irrelevant question and verify fallback without citations.
- [ ] Ask in an empty workspace and verify zero sources / fallback.
- [ ] Fix any production-only issue and repeat until smoke passes.

### Task 5: Publish incremented release images

**Files:**

- Modify: `docker-compose.prod.yml`

**Interfaces:**

- Consumes: release commit and local rehearsal result
- Produces: pushed server image `v10` or higher
- Produces: pushed client image `v7` or higher

- [ ] Choose unused server/client tags.
- [ ] Build server image from release commit.
- [ ] Build client image with `BACKEND_URL=http://nestjs:3000`.
- [ ] Push both images to Alibaba Cloud Registry.
- [ ] Update `docker-compose.prod.yml` image tags.
- [ ] Commit image tag bump.

### Task 6: Back up and migrate production

**Files:**

- Modify: production `.env` outside Git

**Interfaces:**

- Consumes: production compose file
- Produces: timestamped `pg_dump` backup
- Produces: applied Prisma migrations

- [ ] Verify required RAG/storage/JWT env vars exist without printing secrets.
- [ ] Stop or quiesce API, worker, and frontend writes as appropriate.
- [ ] Run `pg_dump` and verify the backup is non-empty.
- [ ] Store the backup off-host.
- [ ] Run `prisma migrate deploy`.
- [ ] Run `prisma migrate status` and ensure no pending migrations.

### Task 7: Deploy production services

**Files:**

- Modify: none expected beyond server compose checkout

**Interfaces:**

- Consumes: pushed images and completed migration
- Produces: running API, worker, frontend stack

- [ ] Pull new images on the VPS.
- [ ] Run `docker compose config` validation.
- [ ] Start PostgreSQL and Redis first.
- [ ] Start API, worker, and frontend.
- [ ] Confirm container health / running status.
- [ ] Inspect API, worker, and frontend logs.

### Task 8: Production smoke and acceptance

**Files:**

- Modify: none expected

**Interfaces:**

- Consumes: live production stack
- Produces: release acceptance evidence

- [ ] Verify `https://cloudstore.kxpwty.cn` returns 200.
- [ ] Verify `/api/auth/providers` returns JSON.
- [ ] Log in with a production test account.
- [ ] Upload a smoke Markdown file and wait for `indexed`.
- [ ] Run relevant RAG question and verify SSE and citations.
- [ ] Run irrelevant question and verify fallback.
- [ ] Run empty-workspace isolation question and verify no leakage.
- [ ] Verify worker logs show completed document-index jobs.
- [ ] Record release SHA, image tags, backup path, and smoke results.

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
