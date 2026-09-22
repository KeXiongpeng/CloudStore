# UI / Docs / OAuth Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Upgrade the cloud-storage project into an interview-ready product with polished responsive UI, complete docs, test accounts, and three OAuth providers.

**Architecture:** Keep the existing Next.js + NestJS + Prisma + Redis + Qiniu S3 architecture. Add a documentation layer around it, modernize presentation pages and dashboard responsiveness, and extend the existing custom OAuth service with state validation and WeChat.

**Tech Stack:** Next.js 14, Tailwind CSS, NestJS, Prisma, PostgreSQL, Redis, Qiniu S3, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-22-ui-docs-oauth-upgrade-design.md`

## Global Constraints

- Production site URL is exactly `https://kxpwty.cn`.
- OAuth callbacks are `/api/auth/{provider}/callback` on the frontend origin.
- WeChat is implemented as code + config but hidden when credentials are absent.
- No real secrets or production passwords in documentation.
- Do not refactor upload, storage, quota, or admin behavior.
- Mobile target starts at 375px; desktop remains first-class.

---

### Task 1: Documentation baseline

**Files:**
- Create: `README.md`
- Create: `docs/ARCHITECTURE.md`
- Create: `docs/DATABASE.md`
- Create: `docs/API.md`
- Create: `docs/DEPLOYMENT.md`
- Modify: `.env.example`

**Interfaces:**
- Produces: public project entrypoint and operations docs referenced by README.

- [x] Write README with overview, feature list, architecture diagram reference, tech stack, local quickstart, environment variables, test accounts, OAuth setup, API summary, deployment summary, and project structure.
- [x] Write architecture and ER docs using Mermaid.
- [x] Write API docs for auth, users, files, public files, and admin endpoints.
- [x] Write Docker Compose local and production deployment docs.
- [x] Extend `.env.example` with `APP_URL`, `FRONTEND_URL`, GitHub, Google, WeChat, and demo account variables.
- [x] Verify required docs exist and contain no real production secrets.

### Task 2: Public homepage and auth pages

**Files:**
- Modify: `client/src/app/page.tsx`
- Modify: `client/src/app/(auth)/layout.tsx`
- Modify: `client/src/app/(auth)/login/page.tsx`
- Modify: `client/src/app/(auth)/register/page.tsx`
- Create: `client/src/components/AuthProviderButtons.tsx`

**Interfaces:**
- Consumes: `GET /api/auth/providers` returning `{ providers: Array<'github'|'google'|'wechat'> }`.
- Produces: reusable third-party login button UI for login and register pages.

- [x] Implement the approved Figma homepage structure with Tailwind responsive utilities.
- [x] Add feature, workflow, tech stack, and footer sections.
- [x] Rebuild login / register cards with shared visual language.
- [x] Fetch configured OAuth providers and render only configured buttons.
- [x] Check layout at 375px, 768px, and 1280px.

### Task 3: Dashboard responsive shell and files UI

**Files:**
- Modify: `client/src/app/(dashboard)/layout.tsx`
- Modify: `client/src/components/Navbar.tsx`
- Modify: `client/src/components/Sidebar.tsx`
- Modify: `client/src/app/(dashboard)/files/page.tsx`
- Modify: `client/src/components/FileRow.tsx`
- Create: `client/src/components/FileCard.tsx`

**Interfaces:**
- Consumes: existing files API response shape.
- Produces: reusable mobile file-card presentation.

- [x] Add mobile navbar menu toggle and collapsible sidebar.
- [x] Preserve desktop fixed sidebar.
- [x] Render table on `md:` and larger screens.
- [x] Render cards below `md:` using the same file data and actions.
- [x] Verify no horizontal scroll at 375px.

### Task 4: OAuth backend and WeChat provider

**Files:**
- Modify: `server/prisma/schema.prisma`
- Create: `server/prisma/migrations/<timestamp>_wechat_oauth/migration.sql`
- Modify: `server/src/common/config/configuration.ts`
- Modify: `server/src/auth/auth.controller.ts`
- Modify: `server/src/auth/auth.service.ts`
- Modify: `server/prisma/seed.ts`

**Interfaces:**
- Consumes: existing `OAuthAccount`, JWT issuance, and Redis refresh-token storage.
- Produces:
  - `GET /api/auth/providers`
  - `GET /api/auth/wechat`
  - `GET /api/auth/wechat/callback`
  - `findOrCreateOAuthUser(provider, providerId, email, nickname?, avatarUrl?)`

- [x] Add `wechat` to `OAuthProvider` and create additive SQL migration.
- [x] Centralize public URL and OAuth redirect URL construction.
- [x] Add state creation and validation using an HttpOnly cookie.
- [x] Fix GitHub email fallback through `/user/emails`.
- [x] Preserve exact Google redirect URI during token exchange.
- [x] Implement WeChat website-app authorize, token, userinfo, and no-email internal identity handling.
- [x] Add provider configuration endpoint.
- [x] Seed admin and demo user with quotas.
- [x] Run Prisma validation and server build.

### Task 5: Frontend OAuth integration

**Files:**
- Modify: `client/src/app/(auth)/login/page.tsx`
- Modify: `client/src/app/(auth)/register/page.tsx`
- Modify: `client/src/app/(auth)/auth/callback/page.tsx`
- Modify: `client/src/contexts/AuthContext.tsx`

**Interfaces:**
- Consumes: provider endpoint and OAuth callback token query parameters.
- Produces: configured-provider buttons and error-aware callback handling.

- [x] Call provider endpoint from auth pages.
- [x] Hide unconfigured providers, including WeChat.
- [x] Display backend OAuth error query state.
- [x] Store access / refresh tokens and refresh user after callback.
- [x] Run client build.

### Task 6: Final verification

**Files:**
- No product file changes unless a verification defect is found.

- [x] Run `npm run build` in `client`.
- [x] Run `npm run build` in `server`.
- [x] Run Prisma format / validate.
- [x] Search modified docs for real secrets.
- [x] Review responsive classes for 375px breakpoints.
- [x] Commit completed work.
