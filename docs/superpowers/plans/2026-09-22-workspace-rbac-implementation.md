# Workspace and RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the personal storage model into a multi-workspace system with backend-enforced roles, permissions, invitations, data isolation, audit logs, and compatible migration of existing personal files.

**Architecture:** Workspace becomes the tenant boundary for files and quotas. A single permission matrix feeds `WorkspaceGuard` and `PermissionGuard`, while `AuditService` records sensitive changes after the business transaction succeeds. Existing users receive one Personal Workspace so legacy files and public `urlKey` values continue to work.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, Redis 7, TypeScript strict, Jest, Next.js 14 App Router, Tailwind CSS, TanStack Query, Zustand.

**Spec:** `docs/superpowers/specs/2026-09-22-workspace-upload-pipeline-design.md`

## Global Constraints

- Local dependencies run through `docker compose -f docker-compose.dev.yml up -d`; PostgreSQL host port is `5433` and Redis host port is `6380`.
- PostgreSQL is the source of truth; Redis is cache/coordination only.
- Every backend file and upload query must include the active `workspaceId`.
- Backend authorization is mandatory; frontend permission checks are presentation only.
- Roles are exactly `OWNER`, `ADMIN`, `EDITOR`, `VIEWER`, and `GUEST`.
- `ADMIN` cannot modify or remove `OWNER`; only `OWNER` can delete a workspace or transfer ownership.
- Existing users must each receive one Personal Workspace.
- Legacy public access must continue using the existing `files.url_key`.
- New uploads with the same name create new files; automatic overwrite is out of scope.
- Do not add Kubernetes.
- Use unified response envelopes and error codes from the approved spec.

---

### Task 0: Dependency Graph, Code Style, Unified Envelope, and CI

**Files:**

- Create: `.prettierrc`
- Create: `.prettierignore`
- Create: `.dependency-cruiser.cjs`
- Create: `.lintstagedrc.json`
- Modify: `package.json`
- Create: `.github/workflows/ci.yml`
- Create: `server/src/common/interceptors/response.interceptor.ts`
- Create: `server/src/common/filters/http-exception.filter.ts`
- Modify: `server/src/main.ts`

**Interfaces:**

- Consumes: existing Nest bootstrap.
- Produces:
  - root commands `npm run deps:graph`, `npm run format:check`;
  - response shape `{ success, code, message, data, requestId }`;
  - dependency rules preventing workspace -> upload/storage and upload -> provider SDK imports;
  - CI job `quality`.

- [ ] **Step 1: Install engineering tooling**

Run from repository root:

```bash
npm install -D prettier@3 eslint@8 dependency-cruiser@16 husky@9 lint-staged@15
```

- [ ] **Step 2: Add formatting and code dependency graph rules**

Create `.prettierrc`:

```json
{
  "semi": true,
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

Create `.prettierignore`:

```text
node_modules
.next
dist
coverage
package-lock.json
```

Create `.dependency-cruiser.cjs`:

```js
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'workspaces-must-not-depend-on-upload-or-storage',
      comment: 'Workspace owns membership/permissions; upload consumes it, not the reverse.',
      severity: 'error',
      from: { path: '^server/src/workspaces/.+' },
      to: { path: '^server/src/(upload|storage)/.+' },
    },
    {
      name: 'audit-must-not-depend-on-business-modules',
      severity: 'error',
      from: { path: '^server/src/audit/.+' },
      to: { path: '^server/src/(workspaces|upload|files|storage|quota)/.+' },
    },
    {
      name: 'upload-must-not-import-private-cross-module-files',
      severity: 'error',
      from: { path: '^server/src/upload/.+' },
      to: { path: '^server/src/(workspaces|storage|quota|audit)/.+\\.(internal|impl)\\.ts$' },
    },
    {
      name: 'client-components-must-not-import-server-code',
      severity: 'error',
      from: { path: '^client/src/.+' },
      to: { path: '^server/src/.+' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'server/tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.tsx', '.js', '.jsx'],
    },
  },
};
```

In root `package.json`, add:

```json
{
  "scripts": {
    "prepare": "husky",
    "deps:graph": "dependency-cruiser --config .dependency-cruiser.cjs server/src client/src",
    "format:check": "prettier --check .",
    "format": "prettier --write ."
  },
  "lint-staged": {
    "*.{ts,tsx,js,jsx,json,md,yml,yaml}": ["prettier --write"]
  }
}
```

Create `.lintstagedrc.json` only if the package JSON field is not used:

```json
{
  "*.{ts,tsx,js,jsx,json,md,yml,yaml}": ["prettier --write"]
}
```

- [ ] **Step 3: Add unified response interceptor**

Create `server/src/common/interceptors/response.interceptor.ts`:

```ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable, map } from 'rxjs';

@Injectable()
export class HttpResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        code: 'OK',
        message: 'ok',
        data,
        requestId: randomUUID(),
      })),
    );
  }
}
```

- [ ] **Step 4: Add unified exception filter**

Create `server/src/common/filters/http-exception.filter.ts`:

```ts
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_ERROR;
    const payload = isHttp ? exception.getResponse() : 'INTERNAL_ERROR';
    const code =
      typeof payload === 'string'
        ? payload
        : ((payload as { code?: string; message?: string | string[] }).code ??
          (payload as { message?: string | string[] }).message ??
          'INTERNAL_ERROR');
    const details =
      typeof payload === 'object' && 'message' in payload
        ? (payload as { message?: string | string[] }).message
        : [];

    if (status >= 500) {
      this.logger.error((exception as Error).stack);
    }

    response.status(status).json({
      success: false,
      code: Array.isArray(code) ? 'VALIDATION_ERROR' : code,
      message: Array.isArray(code) ? '请求参数无效' : code,
      details: Array.isArray(details) ? details : [],
      requestId: randomUUID(),
    });
  }
}
```

In `server/src/main.ts`, after global pipes:

```ts
import { HttpResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

app.useGlobalInterceptors(new HttpResponseInterceptor());
app.useGlobalFilters(new HttpExceptionFilter());
```

Also ensure Swagger is initialized:

```ts
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

const config = new DocumentBuilder()
  .setTitle('CloudDrive API')
  .setVersion('2.0')
  .addBearerAuth()
  .build();
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document);
```

Modify `client/src/lib/api.ts` so existing pages keep using `response.data` while the wire format remains unified. In the success branch of the response interceptor, before returning:

```ts
api.interceptors.response.use(
  (response) => {
    const body = response.data;
    if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
      response.data = body.data;
    }
    return response;
  },
  async (error) => {
    // existing refresh-token logic remains unchanged
    return Promise.reject(error);
  },
);
```

The implementation must preserve the existing 401 refresh logic; only the success branch changes.

- [ ] **Step 5: Add CI quality workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: quality

on:
  push:
    branches: [main, ui-docs-oauth-upgrade, feat/workspace-upload-pipeline]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: csp_user
          POSTGRES_PASSWORD: csp_password_2024
          POSTGRES_DB: cloud_storage
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U csp_user -d cloud_storage"
          --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7-alpine
        ports: ['6380:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 5s --health-retries 10

    env:
      DATABASE_URL: postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public
      REDIS_HOST: localhost
      REDIS_PORT: '6380'
      JWT_SECRET: ci-jwt-secret
      JWT_REFRESH_SECRET: ci-refresh-secret

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm --prefix server ci
      - run: npm --prefix client ci
      - run: npm run format:check
      - run: npm run deps:graph
      - run: npm --prefix server run typecheck
      - run: npm --prefix client run lint
      - run: npm --prefix server test -- --runInBand
      - run: npm --prefix client test -- --run
      - run: npm --prefix server run build
      - run: npm --prefix client run build
```

- [ ] **Step 6: Initialize Husky**

Run from repository root:

```bash
npx husky init
Set-Content -Path .husky\pre-commit -Value "npx lint-staged" -Encoding UTF8
```

On non-Windows use:

```bash
printf 'npx lint-staged\n' > .husky/pre-commit
chmod +x .husky/pre-commit
```

- [ ] **Step 7: Verify quality baseline**

Run from repository root:

```bash
npm run deps:graph
npm run format:check
```

Run from `server/`:

```bash
npm run typecheck
npm test -- --runTestsByPath test/oauth-utils.test.ts
npm run build
```

Expected: `deps:graph` exits `0`; formatting and tests exit `0`. If pre-existing formatting violations are large, run `npm run format` once and commit separately.

- [ ] **Step 8: Commit**

```bash
git add .github .dependency-cruiser.cjs .prettierrc .prettierignore .lintstagedrc.json package.json package-lock.json server/src/common server/src/main.ts .husky
git commit -m "chore(engineering): add dependency graph and api envelope"
```

---

### Task 1: Backend Test and Strict Type Baseline

**Files:**

- Create: `server/jest.config.js`
- Modify: `server/package.json`
- Modify: `server/tsconfig.json`
- Test: `server/test/oauth-utils.test.ts`

**Interfaces:**

- Consumes: existing `oauth-utils.test.ts`.
- Produces: `npm run test`, `npm run test:cov`, and `npm run typecheck` in `server/`.

- [ ] **Step 1: Install backend test dependencies**

Run from `server/`:

```bash
npm install -D jest@29 ts-jest@29 @types/jest@29 supertest@7 @types/supertest@6
```

- [ ] **Step 2: Add Jest configuration**

Create `server/jest.config.js`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageThreshold: {
    global: { branches: 70, functions: 70, lines: 70, statements: 70 },
  },
};
```

Create `server/test/setup-env.ts`:

```ts
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public';
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost';
process.env.REDIS_PORT = process.env.REDIS_PORT || '6380';
```

- [ ] **Step 3: Add scripts and strict TypeScript**

In `server/package.json`, add scripts:

```json
{
  "test": "jest --runInBand",
  "test:watch": "jest --runInBand --watch",
  "test:cov": "jest --runInBand --coverage",
  "typecheck": "tsc --noEmit"
}
```

In `server/tsconfig.json`, ensure:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 4: Verify baseline**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/oauth-utils.test.ts
npm run typecheck
```

Expected: both commands exit `0`. Fix only type errors without changing behavior.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/jest.config.js server/test/setup-env.ts server/tsconfig.json
git commit -m "test(server): add workspace rbac test baseline"
```

---

### Task 2: Single-Source Permission Matrix

**Files:**

- Create: `server/src/workspaces/permissions.ts`
- Create: `server/src/workspaces/types.ts`
- Test: `server/test/workspaces/permissions.spec.ts`

**Interfaces:**

- Consumes: none.
- Produces:

```ts
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'GUEST';
export type WorkspacePermission =
  | 'workspace:view'
  | 'workspace:update'
  | 'workspace:delete'
  | 'member:read'
  | 'member:invite'
  | 'member:update_role'
  | 'member:remove'
  | 'audit:read'
  | 'file:view'
  | 'file:upload'
  | 'file:download'
  | 'file:update'
  | 'file:delete'
  | 'quota:read'
  | 'quota:update';
export function hasWorkspacePermission(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): boolean;
```

- [ ] **Step 1: Write the failing test**

Create `server/test/workspaces/permissions.spec.ts`:

```ts
import {
  hasWorkspacePermission,
  WORKSPACE_ROLE_PERMISSIONS,
} from '../../src/workspaces/permissions';

describe('workspace permission matrix', () => {
  it('grants every permission to OWNER', () => {
    const permissions = Object.values(WORKSPACE_ROLE_PERMISSIONS.OWNER);
    expect(permissions.every(Boolean)).toBe(true);
  });

  it('prevents ADMIN from deleting a workspace', () => {
    expect(hasWorkspacePermission('ADMIN', 'workspace:delete')).toBe(false);
  });

  it('allows EDITOR to upload and delete files', () => {
    expect(hasWorkspacePermission('EDITOR', 'file:upload')).toBe(true);
    expect(hasWorkspacePermission('EDITOR', 'file:delete')).toBe(true);
  });

  it('allows VIEWER view/download but not upload', () => {
    expect(hasWorkspacePermission('VIEWER', 'file:view')).toBe(true);
    expect(hasWorkspacePermission('VIEWER', 'file:download')).toBe(true);
    expect(hasWorkspacePermission('VIEWER', 'file:upload')).toBe(false);
  });

  it('does not grant unknown permission values', () => {
    expect(hasWorkspacePermission('OWNER', 'unknown:permission' as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/permissions.spec.ts
```

Expected: FAIL because `../../src/workspaces/permissions` does not exist.

- [ ] **Step 3: Implement the matrix**

Create `server/src/workspaces/types.ts`:

```ts
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'GUEST';

export type WorkspacePermission =
  | 'workspace:view'
  | 'workspace:update'
  | 'workspace:delete'
  | 'member:read'
  | 'member:invite'
  | 'member:update_role'
  | 'member:remove'
  | 'audit:read'
  | 'file:view'
  | 'file:upload'
  | 'file:download'
  | 'file:update'
  | 'file:delete'
  | 'quota:read'
  | 'quota:update';

export interface WorkspaceActorContext {
  userId: string;
  workspaceId: string;
  memberId: string;
  role: WorkspaceRole;
}
```

Create `server/src/workspaces/permissions.ts`:

```ts
import { WorkspacePermission, WorkspaceRole } from './types';

export const WORKSPACE_ROLE_PERMISSIONS: Record<
  WorkspaceRole,
  Record<WorkspacePermission, boolean>
> = {
  OWNER: {
    'workspace:view': true,
    'workspace:update': true,
    'workspace:delete': true,
    'member:read': true,
    'member:invite': true,
    'member:update_role': true,
    'member:remove': true,
    'audit:read': true,
    'file:view': true,
    'file:upload': true,
    'file:download': true,
    'file:update': true,
    'file:delete': true,
    'quota:read': true,
    'quota:update': true,
  },
  ADMIN: {
    'workspace:view': true,
    'workspace:update': true,
    'workspace:delete': false,
    'member:read': true,
    'member:invite': true,
    'member:update_role': true,
    'member:remove': true,
    'audit:read': true,
    'file:view': true,
    'file:upload': true,
    'file:download': true,
    'file:update': true,
    'file:delete': true,
    'quota:read': true,
    'quota:update': true,
  },
  EDITOR: {
    'workspace:view': true,
    'workspace:update': false,
    'workspace:delete': false,
    'member:read': false,
    'member:invite': false,
    'member:update_role': false,
    'member:remove': false,
    'audit:read': false,
    'file:view': true,
    'file:upload': true,
    'file:download': true,
    'file:update': true,
    'file:delete': true,
    'quota:read': true,
    'quota:update': false,
  },
  VIEWER: {
    'workspace:view': true,
    'workspace:update': false,
    'workspace:delete': false,
    'member:read': false,
    'member:invite': false,
    'member:update_role': false,
    'member:remove': false,
    'audit:read': false,
    'file:view': true,
    'file:upload': false,
    'file:download': true,
    'file:update': false,
    'file:delete': false,
    'quota:read': true,
    'quota:update': false,
  },
  GUEST: {
    'workspace:view': true,
    'workspace:update': false,
    'workspace:delete': false,
    'member:read': false,
    'member:invite': false,
    'member:update_role': false,
    'member:remove': false,
    'audit:read': false,
    'file:view': true,
    'file:upload': false,
    'file:download': true,
    'file:update': false,
    'file:delete': false,
    'quota:read': true,
    'quota:update': false,
  },
};

export function hasWorkspacePermission(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): boolean {
  return WORKSPACE_ROLE_PERMISSIONS[role]?.[permission] === true;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/permissions.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/workspaces/types.ts server/src/workspaces/permissions.ts server/test/workspaces/permissions.spec.ts
git commit -m "feat(workspace): add role permission matrix"
```

---

### Task 3: Workspace RBAC Database Models

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: generated migration under `server/prisma/migrations/<timestamp>_workspace_rbac/migration.sql`

**Interfaces:**

- Consumes: existing `User` model.
- Produces Prisma models `Workspace`, `WorkspaceMember`, `WorkspaceInvitation`, `AuditLog`, and enums `WorkspaceRole`, `WorkspaceMemberStatus`, `WorkspaceStatus`, `InvitationStatus`.

- [ ] **Step 1: Add workspace enums and models**

Append to `server/prisma/schema.prisma`:

```prisma
enum WorkspaceRole {
  OWNER
  ADMIN
  EDITOR
  VIEWER
  GUEST
}

enum WorkspaceStatus {
  active
  suspended
}

enum WorkspaceMemberStatus {
  active
  disabled
}

enum InvitationStatus {
  pending
  accepted
  revoked
  expired
}

model Workspace {
  id            String   @id @default(uuid())
  name          String   @db.VarChar(128)
  slug          String   @unique @db.VarChar(64)
  ownerId       String   @map("owner_id")
  storageDriver String   @default("qiniu") @map("storage_driver") @db.VarChar(32)
  status        WorkspaceStatus @default(active)
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  owner       User @relation("WorkspaceOwner", fields: [ownerId], references: [id])
  members     WorkspaceMember[]
  invitations WorkspaceInvitation[]
  auditLogs   AuditLog[]

  @@index([ownerId])
  @@map("workspaces")
}

model WorkspaceMember {
  id          String   @id @default(uuid())
  workspaceId String   @map("workspace_id")
  userId      String   @map("user_id")
  role        WorkspaceRole
  status      WorkspaceMemberStatus @default(active)
  joinedAt    DateTime @default(now()) @map("joined_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation("WorkspaceMemberships", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
  @@map("workspace_members")
}

model WorkspaceInvitation {
  id          String   @id @default(uuid())
  workspaceId String   @map("workspace_id")
  email       String   @db.VarChar(254)
  role        WorkspaceRole
  tokenHash   String   @unique @map("token_hash")
  invitedBy   String   @map("invited_by")
  status      InvitationStatus @default(pending)
  expiresAt   DateTime @map("expires_at")
  acceptedAt  DateTime? @map("accepted_at")
  createdAt   DateTime @default(now()) @map("created_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, email, status])
  @@index([email])
  @@map("workspace_invitations")
}

model AuditLog {
  id           String   @id @default(uuid())
  workspaceId  String?  @map("workspace_id")
  actorId      String?  @map("actor_id")
  action       String   @db.VarChar(64)
  resourceType String   @map("resource_type") @db.VarChar(32)
  resourceId   String   @map("resource_id") @db.VarChar(64)
  ip           String?  @db.VarChar(64)
  userAgent    String?  @map("user_agent") @db.VarChar(512)
  requestId    String?  @map("request_id") @db.VarChar(64)
  before       Json?
  after        Json?
  createdAt    DateTime @default(now()) @map("created_at")

  workspace Workspace? @relation(fields: [workspaceId], references: [id], onDelete: SetNull)

  @@index([workspaceId, createdAt])
  @@index([workspaceId, actorId, createdAt])
  @@index([workspaceId, resourceType, resourceId])
  @@map("audit_logs")
}
```

Add these relations to `User`:

```prisma
model User {
  ownedWorkspaces      Workspace[]        @relation("WorkspaceOwner")
  workspaceMemberships WorkspaceMember[]  @relation("WorkspaceMemberships")
}
```

Do not duplicate relation fields already present in the real `User` model.

- [ ] **Step 2: Generate an editable migration**

Start dependencies:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Run from `server/`:

```bash
DATABASE_URL="postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public" npx prisma migrate dev --create-only --name workspace_rbac
```

Expected: a new migration folder is created but not applied.

- [ ] **Step 3: Add compatible data migration**

Open the generated `migration.sql` and ensure workspace DDL runs before this appended block. If Prisma adds non-null workspace columns to `files`, split that generated DDL so the column is nullable, backfill it, then set it not null:

```sql
INSERT INTO "workspaces" ("id", "name", "slug", "owner_id", "storage_driver", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  COALESCE(u."nickname", split_part(u."email", '@', 1)) || ' Workspace',
  'u-' || replace(u."id"::text, '-', ''),
  u."id",
  'qiniu',
  'active',
  now(),
  now()
FROM "users" u;

INSERT INTO "workspace_members" ("id", "workspace_id", "user_id", "role", "status", "joined_at", "updated_at")
SELECT gen_random_uuid(), w."id", w."owner_id", 'OWNER', 'active', now(), now()
FROM "workspaces" w;

UPDATE "files"
SET "workspace_id" = w."id",
    "created_by" = "files"."user_id"
FROM "workspaces" w
WHERE "files"."user_id" = w."owner_id";

ALTER TABLE "files" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "files" ALTER COLUMN "created_by" SET NOT NULL;

INSERT INTO "audit_logs" ("id", "workspace_id", "actor_id", "action", "resource_type", "resource_id", "created_at")
SELECT gen_random_uuid(), w."id", w."owner_id", 'workspace.migrated', 'workspace', w."id", now()
FROM "workspaces" w;
```

- [ ] **Step 4: Apply and verify migration**

Run from `server/`:

```bash
DATABASE_URL="postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public" npx prisma migrate dev
DATABASE_URL="postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public" npx prisma generate
```

Then verify with PostgreSQL:

```sql
SELECT count(*) FROM workspaces;
SELECT count(*) FROM workspace_members WHERE role = 'OWNER';
SELECT count(*) FROM files WHERE workspace_id IS NULL;
```

Expected: workspace count equals user count; owner member count equals workspace count; files without workspace equals `0`.

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(workspace): add rbac schema and personal workspace migration"
```

---

### Task 4: Workspace CRUD and Membership Context

**Files:**

- Create: `server/src/workspaces/dto/create-workspace.dto.ts`
- Create: `server/src/workspaces/workspaces.service.ts`
- Create: `server/src/workspaces/workspaces.controller.ts`
- Create: `server/src/workspaces/workspaces.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/workspaces/workspaces.service.spec.ts`

**Interfaces:**

- Consumes: `PrismaService`.
- Produces:

```ts
class WorkspacesService {
  createWorkspace(userId: string, dto: CreateWorkspaceDto): Promise<Workspace>;
  listWorkspaces(userId: string): Promise<WorkspaceMember[]>;
  getWorkspace(actor: WorkspaceActorContext): Promise<Workspace | null>;
  updateWorkspace(actor: WorkspaceActorContext, dto: UpdateWorkspaceDto): Promise<Workspace>;
  deleteWorkspace(actor: WorkspaceActorContext): Promise<{ id: string }>;
  requireMembership(workspaceId: string, userId: string): Promise<WorkspaceActorContext>;
}
```

- [ ] **Step 1: Write the failing service test**

Create `server/test/workspaces/workspaces.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspacesService } from '../../src/workspaces/workspaces.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  const prisma = {
    workspace: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    workspaceMember: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [WorkspacesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(WorkspacesService);
  });

  it('requires an active membership', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    await expect(service.requireMembership('workspace-1', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects disabled members', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'EDITOR',
      status: 'disabled',
    });
    await expect(service.requireMembership('workspace-1', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns an actor context for active members', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'EDITOR',
      status: 'active',
    });
    await expect(service.requireMembership('workspace-1', 'user-1')).resolves.toMatchObject({
      memberId: 'member-1',
      role: 'EDITOR',
    });
  });

  it('rejects workspace deletion by non-owner', async () => {
    await expect(
      service.deleteWorkspace({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        memberId: 'member-1',
        role: 'ADMIN',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/workspaces.service.spec.ts
```

Expected: FAIL because `WorkspacesService` does not exist.

- [ ] **Step 3: Create DTO and service**

Create `server/src/workspaces/dto/create-workspace.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(128)
  name!: string;
}

export class UpdateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(128)
  name!: string;
}
```

Create `server/src/workspaces/workspaces.service.ts`:

```ts
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActorContext } from './types';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async requireMembership(workspaceId: string, userId: string): Promise<WorkspaceActorContext> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });

    if (!member || member.workspace.status !== 'active') {
      throw new NotFoundException('WORKSPACE_NOT_FOUND');
    }
    if (member.status !== 'active') {
      throw new ForbiddenException('WORKSPACE_MEMBER_INACTIVE');
    }

    return { userId, workspaceId, memberId: member.id, role: member.role };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    const baseSlug = this.slugify(dto.name);
    if (!baseSlug) throw new BadRequestException('VALIDATION_ERROR');

    for (let index = 0; index < 20; index += 1) {
      const slug = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
      if (await this.prisma.workspace.findUnique({ where: { slug } })) continue;

      return this.prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: { name: dto.name, slug, ownerId: userId, storageDriver: 'qiniu' },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId, role: 'OWNER' },
        });
        return workspace;
      });
    }

    throw new ConflictException('WORKSPACE_SLUG_EXHAUSTED');
  }

  async listWorkspaces(userId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { userId, status: 'active', workspace: { status: 'active' } },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async getWorkspace(actor: WorkspaceActorContext) {
    return this.prisma.workspace.findFirst({
      where: { id: actor.workspaceId, status: 'active' },
      include: { members: { where: { status: 'active' } } },
    });
  }

  async updateWorkspace(actor: WorkspaceActorContext, dto: UpdateWorkspaceDto) {
    return this.prisma.workspace.update({
      where: { id: actor.workspaceId },
      data: { name: dto.name },
    });
  }

  async deleteWorkspace(actor: WorkspaceActorContext) {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }
    await this.prisma.workspace.delete({ where: { id: actor.workspaceId } });
    return { id: actor.workspaceId };
  }
}
```

- [ ] **Step 4: Add controller and module**

Create `server/src/workspaces/workspaces.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Patch, Post, Param, UseGuards } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceGuard } from './guards/workspace.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermission } from './decorators/require-permission.decorator';
import { WorkspaceActor } from './decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from './types';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.createWorkspace(userId, dto);
  }

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.workspacesService.listWorkspaces(userId);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('workspace:view')
  get(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.workspacesService.getWorkspace(actor);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('workspace:update')
  update(@WorkspaceActor() actor: WorkspaceActorContext, @Body() dto: UpdateWorkspaceDto) {
    return this.workspacesService.updateWorkspace(actor, dto);
  }

  @Delete(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('workspace:delete')
  delete(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.workspacesService.deleteWorkspace(actor);
  }
}
```

Create `server/src/workspaces/workspaces.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceGuard } from './guards/workspace.guard';
import { PermissionGuard } from './guards/permission.guard';

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceGuard, PermissionGuard],
  exports: [WorkspacesService, WorkspaceGuard, PermissionGuard],
})
export class WorkspacesModule {}
```

Register `WorkspacesModule` in `server/src/app.module.ts`.

- [ ] **Step 5: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/workspaces.service.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/workspaces server/src/app.module.ts server/test/workspaces
git commit -m "feat(workspace): add workspace crud and membership context"
```

---

### Task 5: Workspace and Permission Guards

**Files:**

- Create: `server/src/workspaces/decorators/require-permission.decorator.ts`
- Create: `server/src/workspaces/decorators/workspace-actor.decorator.ts`
- Create: `server/src/workspaces/guards/workspace.guard.ts`
- Create: `server/src/workspaces/guards/permission.guard.ts`
- Test: `server/test/workspaces/permission.guard.spec.ts`

**Interfaces:**

- Consumes: `WorkspacesService.requireMembership`, `hasWorkspacePermission`.
- Produces:

```ts
@RequirePermission(permission: WorkspacePermission)
@WorkspaceActor(): WorkspaceActorContext
class WorkspaceGuard implements CanActivate
class PermissionGuard implements CanActivate
```

- [ ] **Step 1: Write the failing guard test**

Create `server/test/workspaces/permission.guard.spec.ts`:

```ts
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../src/workspaces/guards/permission.guard';

function createContext(role: string): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        workspaceActor: { userId: 'u', workspaceId: 'w', memberId: 'm', role },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  it('denies when the role lacks the required permission', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'get').mockReturnValue('file:upload');
    const guard = new PermissionGuard(reflector);

    expect(() => guard.canActivate(createContext('VIEWER'))).toThrow(ForbiddenException);
  });

  it('allows when the role has the required permission', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'get').mockReturnValue('file:upload');
    const guard = new PermissionGuard(reflector);

    expect(guard.canActivate(createContext('EDITOR'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/permission.guard.spec.ts
```

Expected: FAIL because `PermissionGuard` does not exist.

- [ ] **Step 3: Implement decorators and guards**

Create `server/src/workspaces/decorators/require-permission.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';
import { WorkspacePermission } from '../types';

export const WORKSPACE_PERMISSION_KEY = 'workspacePermission';

export const RequirePermission = (permission: WorkspacePermission) =>
  SetMetadata(WORKSPACE_PERMISSION_KEY, permission);
```

Create `server/src/workspaces/decorators/workspace-actor.decorator.ts`:

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { WorkspaceActorContext } from '../types';

export const WorkspaceActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceActorContext =>
    context.switchToHttp().getRequest().workspaceActor,
);
```

Create `server/src/workspaces/guards/workspace.guard.ts`:

```ts
import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { WorkspacesService } from '../workspaces.service';

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly workspacesService: WorkspacesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: { id?: string } }>();
    const workspaceId = request.params.workspaceId;
    const userId = request.user?.id;

    if (!workspaceId || !userId) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND');
    }

    request.workspaceActor = await this.workspacesService.requireMembership(workspaceId, userId);
    return true;
  }
}
```

Create `server/src/workspaces/guards/permission.guard.ts`:

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasWorkspacePermission } from '../permissions';
import { WORKSPACE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { WorkspaceActorContext, WorkspacePermission } from '../types';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<WorkspacePermission>(
      WORKSPACE_PERMISSION_KEY,
      context.getHandler(),
    );
    const actor = context.switchToHttp().getRequest().workspaceActor as
      WorkspaceActorContext | undefined;

    if (!actor || !required || !hasWorkspacePermission(actor.role, required)) {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    return true;
  }
}
```

If TypeScript reports that `workspaceActor` is absent from `Request`, extend Express Request in `server/src/types/express.d.ts`:

```ts
import { WorkspaceActorContext } from '../workspaces/types';

declare global {
  namespace Express {
    interface Request {
      workspaceActor?: WorkspaceActorContext;
    }
  }
}
```

Update `WorkspacesModule` exports to include both guards.

- [ ] **Step 4: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/permission.guard.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/workspaces server/src/types server/test/workspaces
git commit -m "feat(workspace): enforce workspace rbac guards"
```

---

### Task 6: Audit Service and Audit Query API

**Files:**

- Create: `server/src/audit/audit.service.ts`
- Create: `server/src/audit/audit.controller.ts`
- Create: `server/src/audit/audit.module.ts`
- Create: `server/src/audit/dto/query-audit-log.dto.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/audit/audit.service.spec.ts`

**Interfaces:**

- Consumes: `PrismaService`, `audit:read` permission.
- Produces:

```ts
class AuditService {
  record(input: RecordAuditInput): Promise<void>;
  list(workspaceId: string, query: QueryAuditLogDto): Promise<PaginationResponse<AuditLog>>;
}
```

- [ ] **Step 1: Write the failing audit test**

Create `server/test/audit/audit.service.spec.ts`:

```ts
import { AuditService } from '../../src/audit/audit.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AuditService', () => {
  it('normalizes request context and writes after transaction success', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.record({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      action: 'member.role_changed',
      resourceType: 'member',
      resourceId: 'member-1',
      ip: '127.0.0.1',
      userAgent: 'jest',
      requestId: 'request-1',
      before: { role: 'EDITOR' },
      after: { role: 'ADMIN' },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'workspace-1',
          action: 'member.role_changed',
          resourceType: 'member',
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/audit/audit.service.spec.ts
```

Expected: FAIL because `AuditService` does not exist.

- [ ] **Step 3: Implement AuditService**

Create `server/src/audit/audit.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditInput {
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  resourceType: 'workspace' | 'member' | 'file' | 'upload' | 'invitation';
  resourceId: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          workspaceId: input.workspaceId ?? null,
          actorId: input.actorId ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          requestId: input.requestId ?? null,
          before:
            input.before === undefined ? Prisma.JsonNull : (input.before as Prisma.InputJsonValue),
          after:
            input.after === undefined ? Prisma.JsonNull : (input.after as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      this.logger.error(`audit write failed for ${input.action}`, (error as Error).stack);
    }
  }

  async list(
    workspaceId: string,
    query: {
      page: number;
      limit: number;
      action?: string;
      actorId?: string;
      resourceType?: string;
    },
  ) {
    const where = {
      workspaceId,
      action: query.action,
      actorId: query.actorId,
      resourceType: query.resourceType,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
```

- [ ] **Step 4: Add DTO, controller, and module**

Create `server/src/audit/dto/query-audit-log.dto.ts`:

```ts
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAuditLogDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsIn(['workspace', 'member', 'file', 'upload', 'invitation'])
  resourceType?: string;
}
```

Create `server/src/audit/audit.controller.ts`:

```ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard, PermissionGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('workspaces/:workspaceId/audit-logs')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('audit:read')
  list(@WorkspaceActor() actor: WorkspaceActorContext, @Query() query: QueryAuditLogDto) {
    return this.auditService.list(actor.workspaceId, query);
  }
}
```

Create `server/src/audit/audit.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

Register `AuditModule` in `AppModule`.

- [ ] **Step 5: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/audit/audit.service.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/audit server/src/app.module.ts server/test/audit
git commit -m "feat(audit): add workspace audit trail and query api"
```

---

### Task 7: Invitations and Member Management

**Files:**

- Create: `server/src/workspaces/dto/member.dto.ts`
- Create: `server/src/workspaces/member.service.ts`
- Create: `server/src/workspaces/member.controller.ts`
- Modify: `server/src/workspaces/workspaces.module.ts`
- Test: `server/test/workspaces/member.service.spec.ts`

**Interfaces:**

- Consumes: `AuditService`, workspace Prisma models.
- Produces:

```ts
class MemberService {
  listMembers(actor: WorkspaceActorContext): Promise<WorkspaceMember[]>;
  inviteMember(
    actor: WorkspaceActorContext,
    dto: InviteMemberDto,
    context: RequestContext,
  ): Promise<InvitationResponse>;
  updateMemberRole(
    actor: WorkspaceActorContext,
    memberId: string,
    dto: UpdateMemberRoleDto,
    context: RequestContext,
  ): Promise<WorkspaceMember>;
  removeMember(
    actor: WorkspaceActorContext,
    memberId: string,
    context: RequestContext,
  ): Promise<{ id: string }>;
  acceptInvitation(userId: string, token: string): Promise<WorkspaceMember>;
}
```

- [ ] **Step 1: Write failing ownership and expiry tests**

Create `server/test/workspaces/member.service.spec.ts`:

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MemberService } from '../../src/workspaces/member.service';

const prisma: any = {
  workspaceMember: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
  },
  workspaceInvitation: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  user: { findUnique: jest.fn() },
  $transaction: jest.fn(),
};
const audit = { record: jest.fn().mockResolvedValue(undefined) };

describe('MemberService authorization', () => {
  let service: MemberService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MemberService(prisma, audit);
  });

  it('rejects ADMIN attempts to change OWNER role', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'owner-member',
      workspaceId: 'w1',
      userId: 'owner',
      role: 'OWNER',
      status: 'active',
    });

    await expect(
      service.updateMemberRole(
        { userId: 'admin', workspaceId: 'w1', memberId: 'admin-member', role: 'ADMIN' },
        'owner-member',
        { role: 'EDITOR' },
        { ip: '127.0.0.1', userAgent: 'jest', requestId: 'r1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects removal of an OWNER', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'owner-member',
      workspaceId: 'w1',
      userId: 'owner',
      role: 'OWNER',
      status: 'active',
    });

    await expect(
      service.removeMember(
        { userId: 'owner', workspaceId: 'w1', memberId: 'owner-member', role: 'OWNER' },
        'owner-member',
        { ip: '127.0.0.1', userAgent: 'jest', requestId: 'r1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects expired invitations', async () => {
    prisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      tokenHash: 'hash',
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000),
      workspaceId: 'w1',
      role: 'EDITOR',
    });

    await expect(service.acceptInvitation('user-1', 'token')).rejects.toThrow(NotFoundException);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/member.service.spec.ts
```

Expected: FAIL because `MemberService` does not exist.

- [ ] **Step 3: Implement DTOs**

Create `server/src/workspaces/dto/member.dto.ts`:

```ts
import { IsEmail, IsIn, IsUUID } from 'class-validator';
import { WorkspaceRole } from '../types';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(['ADMIN', 'EDITOR', 'VIEWER', 'GUEST'])
  role!: Exclude<WorkspaceRole, 'OWNER'>;
}

export class UpdateMemberRoleDto {
  @IsIn(['ADMIN', 'EDITOR', 'VIEWER', 'GUEST'])
  role!: Exclude<WorkspaceRole, 'OWNER'>;
}

export class AcceptInvitationDto {
  @IsUUID()
  token!: string;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  requestId: string;
}
```

- [ ] **Step 4: Implement MemberService**

Create `server/src/workspaces/member.service.ts`:

```ts
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkspaceActorContext } from './types';
import { InviteMemberDto, RequestContext, UpdateMemberRoleDto } from './dto/member.dto';

@Injectable()
export class MemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listMembers(actor: WorkspaceActorContext) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId: actor.workspaceId, status: 'active' },
      include: { user: { select: { id: true, email: true, nickname: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  private async requireTargetMember(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findUnique({ where: { id: memberId } });
    if (!member || member.workspaceId !== workspaceId || member.status !== 'active') {
      throw new NotFoundException('WORKSPACE_MEMBER_NOT_FOUND');
    }
    return member;
  }

  async updateMemberRole(
    actor: WorkspaceActorContext,
    memberId: string,
    dto: UpdateMemberRoleDto,
    context: RequestContext,
  ) {
    const target = await this.requireTargetMember(actor.workspaceId, memberId);
    if (target.role === 'OWNER') {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      include: { user: { select: { id: true, email: true, nickname: true, avatarUrl: true } } },
    });

    await this.audit.record({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: 'member.role_changed',
      resourceType: 'member',
      resourceId: memberId,
      before: { role: target.role },
      after: { role: dto.role },
      ...context,
    });

    return updated;
  }

  async removeMember(actor: WorkspaceActorContext, memberId: string, context: RequestContext) {
    const target = await this.requireTargetMember(actor.workspaceId, memberId);
    if (target.role === 'OWNER') {
      throw new ForbiddenException('WORKSPACE_OWNER_CANNOT_BE_REMOVED');
    }

    await this.prisma.workspaceMember.delete({ where: { id: memberId } });
    await this.audit.record({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: 'member.removed',
      resourceType: 'member',
      resourceId: memberId,
      before: { role: target.role },
      ...context,
    });

    return { id: memberId };
  }

  async inviteMember(actor: WorkspaceActorContext, dto: InviteMemberDto, context: RequestContext) {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        workspaceId: actor.workspaceId,
        email: dto.email.toLowerCase(),
        role: dto.role,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.audit.record({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: 'member.invited',
      resourceType: 'invitation',
      resourceId: invitation.id,
      after: { email: dto.email, role: dto.role },
      ...context,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      token,
    };
  }

  async acceptInvitation(userId: string, token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await this.prisma.workspaceInvitation.findUnique({ where: { tokenHash } });

    if (!invitation || invitation.status !== 'pending' || invitation.expiresAt <= new Date()) {
      throw new NotFoundException('WORKSPACE_INVITATION_NOT_FOUND');
    }

    const exists = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
    });
    if (exists) throw new ConflictException('WORKSPACE_MEMBER_ALREADY_EXISTS');

    return this.prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });

      return tx.workspaceMember.create({
        data: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      });
    });
  }
}
```

- [ ] **Step 5: Add member routes**

Create `server/src/workspaces/member.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard, PermissionGuard } from './guards';
import { RequirePermission } from './decorators/require-permission.decorator';
import { WorkspaceActor } from './decorators/workspace-actor.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkspaceActorContext } from './types';
import { MemberService } from './member.service';
import { AcceptInvitationDto, InviteMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

function requestContext(req: Request) {
  return {
    ip: (req.ip || 'unknown') as string,
    userAgent: (req.headers['user-agent'] || 'unknown') as string,
    requestId: (req.headers['x-request-id'] || 'unknown') as string,
  };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get('workspaces/:workspaceId/members')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:read')
  list(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.memberService.listMembers(actor);
  }

  @Post('workspaces/:workspaceId/invitations')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:invite')
  invite(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Body() dto: InviteMemberDto,
    @Req() req: Request,
  ) {
    return this.memberService.inviteMember(actor, dto, requestContext(req));
  }

  @Patch('workspaces/:workspaceId/members/:memberId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:update_role')
  updateRole(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    return this.memberService.updateMemberRole(actor, memberId, dto, requestContext(req));
  }

  @Delete('workspaces/:workspaceId/members/:memberId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:remove')
  remove(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('memberId') memberId: string,
    @Req() req: Request,
  ) {
    return this.memberService.removeMember(actor, memberId, requestContext(req));
  }

  @Post('invitations/accept')
  accept(@CurrentUser('id') userId: string, @Body() dto: AcceptInvitationDto) {
    return this.memberService.acceptInvitation(userId, dto.token);
  }
}
```

Create `server/src/workspaces/guards/index.ts`:

```ts
export * from './workspace.guard';
export * from './permission.guard';
```

Register `MemberController` and `MemberService`, and import `AuditModule` in `WorkspacesModule`.

- [ ] **Step 6: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/workspaces/member.service.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/workspaces server/test/workspaces
git commit -m "feat(workspace): add invitations and member management"
```

---

### Task 8: Workspace Data Isolation Integration Test

**Files:**

- Create: `server/test/workspaces/workspace-isolation.e2e-spec.ts`
- Create: `server/test/jest-e2e.json`

**Interfaces:**

- Consumes: Phase 2 backend APIs.
- Produces: repeatable proof that a non-member cannot read or mutate another workspace.

- [ ] **Step 1: Add e2e config**

Create `server/test/jest-e2e.json`:

```json
{
  "rootDir": ".",
  "testEnvironment": "node",
  "preset": "ts-jest",
  "testRegex": ".e2e-spec.ts$",
  "setupFiles": ["./setup-env.ts"]
}
```

- [ ] **Step 2: Write failing isolation test**

Create `server/test/workspaces/workspace-isolation.e2e-spec.ts`:

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Workspace data isolation', () => {
  let app: INestApplication;
  let ownerAToken: string;
  let ownerBToken: string;
  let workspaceA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const suffix = Date.now();
    const register = async (email: string) => {
      await request(app.getHttpServer()).post('/api/auth/register').send({
        email,
        password: 'Password123!',
        nickname: 'Isolation Test',
      });
      const login = await request(app.getHttpServer()).post('/api/auth/login').send({
        email,
        password: 'Password123!',
      });
      return login.body.data.access_token as string;
    };

    ownerAToken = await register(`a-${suffix}@example.com`);
    ownerBToken = await register(`b-${suffix}@example.com`);

    const created = await request(app.getHttpServer())
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Workspace A' });
    workspaceA = created.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks a user who is not a member of workspace A', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/workspaces/${workspaceA}`)
      .set('Authorization', `Bearer ${ownerBToken}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('prevents a non-member from inviting members', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceA}/invitations`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ email: 'new-member@example.com', role: 'VIEWER' });

    expect(response.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run e2e and verify isolation behavior**

Run from `server/`:

```bash
npm test -- --config test/jest-e2e.json --runInBand --testPathPattern workspace-isolation
```

Expected: PASS. A failure means a route is missing `WorkspaceGuard` or leaks workspace existence.

- [ ] **Step 4: Commit**

```bash
git add server/test
git commit -m "test(workspace): prove cross workspace isolation"
```

---

### Task 9: Frontend Workspace Context and Member UI

**Files:**

- Create: `client/src/features/workspace/api.ts`
- Create: `client/src/features/workspace/store.ts`
- Create: `client/src/features/workspace/types.ts`
- Create: `client/src/app/(dashboard)/workspaces/new/page.tsx`
- Create: `client/src/app/(dashboard)/workspaces/[workspaceId]/members/page.tsx`
- Modify: `client/src/app/(dashboard)/layout.tsx`
- Modify: `client/package.json`

**Interfaces:**

- Consumes: `/api/workspaces`, workspace member and invitation endpoints.
- Produces `useWorkspaces()`, `useWorkspaceMembers()`, `useWorkspaceStore()`, and `UI_PERMISSIONS`.

- [ ] **Step 1: Install frontend dependencies**

Run from `client/`:

```bash
npm install @tanstack/react-query zustand react-hook-form zod @hookform/resolvers
```

- [ ] **Step 2: Define shared frontend types and presentation permission matrix**

Create `client/src/features/workspace/types.ts`:

```ts
export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'GUEST';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  id: string;
  role: WorkspaceRole;
  status: 'active' | 'disabled';
  user: { id: string; email: string; nickname?: string | null; avatarUrl?: string | null };
}

export const UI_PERMISSIONS: Record<
  WorkspaceRole,
  {
    upload: boolean;
    manageMembers: boolean;
    viewAudit: boolean;
  }
> = {
  OWNER: { upload: true, manageMembers: true, viewAudit: true },
  ADMIN: { upload: true, manageMembers: true, viewAudit: true },
  EDITOR: { upload: true, manageMembers: false, viewAudit: false },
  VIEWER: { upload: false, manageMembers: false, viewAudit: false },
  GUEST: { upload: false, manageMembers: false, viewAudit: false },
};
```

- [ ] **Step 3: Add API hooks and workspace store**

Create `client/src/features/workspace/api.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Workspace, WorkspaceMember, WorkspaceRole } from './types';

export const workspaceKeys = {
  all: ['workspaces'] as const,
  members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
};

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: async () => {
      const response = await api.get<{ data: Workspace[] }>('/workspaces');
      return response.data;
    },
  });
}

export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: async () => {
      const response = await api.get<{ data: WorkspaceMember[] }>(
        `/workspaces/${workspaceId}/members`,
      );
      return response.data;
    },
    enabled: Boolean(workspaceId),
  });
}

export function useInviteMember(workspaceId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: Exclude<WorkspaceRole, 'OWNER'> }) => {
      const response = await api.post(`/workspaces/${workspaceId}/invitations`, input);
      return response.data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) }),
  });
}
```

Create `client/src/features/workspace/store.ts`:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Workspace } from './types';

interface WorkspaceState {
  currentWorkspaceId: string | null;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      currentWorkspaceId: null,
      setCurrentWorkspace: (workspace) => set({ currentWorkspaceId: workspace?.id ?? null }),
    }),
    { name: 'clouddrive.current-workspace' },
  ),
);
```

- [ ] **Step 4: Add create workspace page**

Create `client/src/app/(dashboard)/workspaces/new/page.tsx`:

```tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

const schema = z.object({ name: z.string().min(2).max(128) });
type FormValues = z.infer<typeof schema>;

export default function NewWorkspacePage() {
  const router = useRouter();
  const client = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const response = await api.post('/workspaces', values);
      return response.data as { id: string };
    },
    onSuccess: (workspace) => {
      client.invalidateQueries({ queryKey: ['workspaces'] });
      router.push('/dashboard');
    },
  });

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-6 text-2xl font-semibold">Create workspace</h1>
      <form className="space-y-4" onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <label className="block text-sm font-medium">Name</label>
        <input
          {...register('name')}
          className="w-full rounded-md border px-3 py-2 dark:bg-neutral-900"
        />
        {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
        <button
          disabled={isSubmitting || mutation.isPending}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          Create
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Add member management page**

Create `client/src/app/(dashboard)/workspaces/[workspaceId]/members/page.tsx`.

Required behavior:

- read `workspaceId` from route params;
- load members with `useWorkspaceMembers`;
- show email, nickname, role, and join date;
- render an invite form only when `UI_PERMISSIONS[role].manageMembers` is true;
- allow invite role values `ADMIN`, `EDITOR`, `VIEWER`, `GUEST`;
- allow role update through `PATCH /workspaces/:workspaceId/members/:memberId`;
- allow remove through `DELETE /workspaces/:workspaceId/members/:memberId`;
- disable changing or removing any member whose role is `OWNER`;
- use TanStack Query invalidation for member queries;
- style with Tailwind and include dark mode variants.

Use this API wrapper for role update:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { workspaceKeys } from '../../api';
import { WorkspaceRole } from '../../types';

export function useUpdateMemberRole(workspaceId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { memberId: string; role: Exclude<WorkspaceRole, 'OWNER'> }) => {
      await api.patch(`/workspaces/${workspaceId}/members/${input.memberId}`, { role: input.role });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) }),
  });
}
```

- [ ] **Step 6: Add workspace switcher to dashboard layout**

Modify `client/src/app/(dashboard)/layout.tsx`:

- call `useWorkspaces()`;
- render a `<select>` of workspaces;
- persist selection with `useWorkspaceStore`;
- include a link to `/workspaces/new`;
- provide the selected workspace ID to dashboard navigation.

- [ ] **Step 7: Verify frontend**

Run from `client/`:

```bash
npm run lint
npm run build
```

Expected: both PASS.

Manual checks:

1. User A creates Workspace A.
2. User B cannot open Workspace A members route data.
3. A invites B as `EDITOR`.
4. B accepts and can see Workspace A.
5. Switching workspaces changes the active workspace ID.

- [ ] **Step 8: Commit**

```bash
git add client/src client/package.json client/package-lock.json
git commit -m "feat(client): add workspace switching and member management"
```

---

### Task 10: Legacy Compatibility and Phase 2 Regression

**Files:**

- Modify: `server/src/files/files.service.ts`
- Modify: `server/src/files/files.controller.ts`
- Modify: `server/src/public/public.service.ts`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/DATABASE.md`
- Modify: `docs/API.md`
- Test: `server/test/workspaces/workspace-isolation.e2e-spec.ts`

**Interfaces:**

- Consumes: migrated `files.workspace_id`.
- Produces workspace-scoped file APIs while preserving `GET /api/public/files/:urlKey`.

- [ ] **Step 1: Make file APIs workspace-aware**

In `server/src/files/files.service.ts`:

- replace every `where: { userId }` file query with `where: { workspaceId, deletedAt: null }`;
- accept `WorkspaceActorContext` instead of a raw `userId` for workspace file methods;
- retain the existing method names `getFiles`, `getFile`, and `deleteFile`.

In `server/src/files/files.controller.ts`:

- add `WorkspaceGuard`, `PermissionGuard`, and `WorkspaceActor` to workspace file routes;
- use permission mapping:

| Route                                           | Permission    |
| ----------------------------------------------- | ------------- |
| `GET /workspaces/:workspaceId/files`            | `file:view`   |
| `GET /workspaces/:workspaceId/files/:fileId`    | `file:view`   |
| `DELETE /workspaces/:workspaceId/files/:fileId` | `file:delete` |

In `server/src/public/public.service.ts`:

- continue lookup by `urlKey`;
- require `deletedAt: null` and `workspace.status === 'active'`;
- do not require workspace membership for files explicitly marked public.

- [ ] **Step 2: Verify migration compatibility manually**

Start the migrated local database and run:

```sql
SELECT count(*) AS files_without_workspace
FROM files
WHERE workspace_id IS NULL;

SELECT count(*) AS broken_public_files
FROM files f
JOIN workspaces w ON w.id = f.workspace_id
WHERE f.url_key IS NOT NULL AND w.status <> 'active';
```

Expected: both counts are `0`.

- [ ] **Step 3: Update docs**

Update:

- `docs/ARCHITECTURE.md`: add JWT -> `WorkspaceGuard` -> `PermissionGuard` -> Service flow.
- `docs/DATABASE.md`: add Workspace, WorkspaceMember, Invitation, and AuditLog ER relationships.
- `docs/API.md`: add workspace, member, invitation, audit endpoints, permissions, and error codes:
  - `WORKSPACE_NOT_FOUND`
  - `WORKSPACE_PERMISSION_DENIED`
  - `WORKSPACE_MEMBER_INACTIVE`
  - `WORKSPACE_MEMBER_ALREADY_EXISTS`
  - `WORKSPACE_INVITATION_NOT_FOUND`
  - `WORKSPACE_OWNER_CANNOT_BE_REMOVED`

- [ ] **Step 4: Run full Phase 2 verification**

From repository root:

```bash
docker compose -f docker-compose.dev.yml up -d
```

From `server/`:

```bash
npm run lint --if-present
npm run typecheck
npm test -- --runInBand
npm test -- --config test/jest-e2e.json --runInBand
```

From `client/`:

```bash
npm run lint
npm run build
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

```bash
git add server/src server/test docs
git commit -m "feat(workspace): complete rbac regression and docs"
```
