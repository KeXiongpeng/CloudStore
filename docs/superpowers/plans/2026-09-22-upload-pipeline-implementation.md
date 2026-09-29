# Upload Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace basic upload handling with an enterprise upload pipeline supporting direct upload, multipart upload, resume, instant upload, deduplication, retries, concurrency limits, quota reservation, session expiry, and async thumbnails.

**Architecture:** PostgreSQL stores upload sessions, chunk state, storage objects, files, file versions, and quotas. Redis provides distributed merge locks and rate coordination only. A storage abstraction hides MinIO and Qiniu differences behind one S3-compatible interface. BullMQ executes thumbnail generation after upload completion.

**Tech Stack:** NestJS 10, Prisma 5, PostgreSQL 16, Redis 7, BullMQ, AWS S3 SDK, MinIO, Qiniu S3-compatible storage, Next.js 14, Zustand, TanStack Query, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-09-22-workspace-upload-pipeline-design.md`

## Global Constraints

- This plan depends on `docs/superpowers/plans/2026-09-22-workspace-rbac-implementation.md`.
- Every upload route requires `WorkspaceGuard`, `PermissionGuard`, and `file:upload`.
- `upload_sessions.workspace_id` and `upload_chunks.upload_session_id` are mandatory.
- Chunk index starts at `1`; chunk size range is `5242880` to `16777216` bytes.
- Default chunk size is `8388608` bytes.
- Files `<= 8388608` bytes use `direct`; larger files use `multipart`.
- Hash algorithm is SHA-256 and field value is lowercase hex.
- Session TTL default is `24` hours.
- Client default concurrency is at most 3 active file uploads and sequential chunks inside each file.
- Each chunk retries automatically 3 times with 1s, 2s, 4s backoff.
- Quota uses reservation: `reserved_size` on session creation, then `reserved_size -= size` and `used_size += size` on completion.
- Local storage is MinIO; production storage remains Qiniu.
- Storage access must go through `StorageService`; upload code must not import S3 or Qiniu SDKs directly.
- Thumbnail failure must not mark an upload failed.
- Frontend permission checks are presentation only.

---

### Task 1: Local MinIO Infrastructure and Storage Driver Contract

**Files:**

- Modify: `docker-compose.dev.yml`
- Modify: `.env.example`
- Create: `server/src/storage/storage-driver.ts`
- Create: `server/src/storage/minio-storage.driver.ts`
- Create: `server/src/storage/qiniu-storage.driver.ts`
- Create: `server/src/storage/storage.service.ts`
- Create: `server/src/storage/storage.module.ts`
- Modify: `server/src/common/config/configuration.ts`
- Test: `server/test/storage/storage.service.spec.ts`

**Interfaces:**

- Consumes: existing AWS S3 SDK dependency.
- Produces:

```ts
interface StorageDriver {
  createDirectPutUrl(input: DirectPutUrlInput): Promise<string>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  createMultipart(input: CreateMultipartInput): Promise<{ uploadId: string }>;
  createPartPutUrl(input: PartPutUrlInput): Promise<string>;
  completeMultipart(input: CompleteMultipartInput): Promise<{ key: string; etag?: string }>;
  abortMultipart(input: AbortMultipartInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
}
```

- [ ] **Step 1: Add MinIO to development Compose**

Append this service to `docker-compose.dev.yml`:

```yaml
minio:
  image: minio/minio:RELEASE.2024-09-22T00-33-43Z
  container_name: csp-minio-dev
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-minioadmin}
  ports:
    - '9000:9000'
    - '9001:9001'
  volumes:
    - minio-dev-data:/data
  healthcheck:
    test: ['CMD', 'mc', 'ready', 'local']
    interval: 5s
    timeout: 5s
    retries: 5
  networks:
    - csp-dev-network

minio-init:
  image: minio/mc:RELEASE.2024-09-16T17-43-14Z
  container_name: csp-minio-init-dev
  depends_on:
    minio:
      condition: service_healthy
  entrypoint: >
    /bin/sh -c "
    mc alias set local http://minio:9000 ${MINIO_ROOT_USER:-minioadmin} ${MINIO_ROOT_PASSWORD:-minioadmin};
    mc mb --ignore-existing local/${MINIO_BUCKET:-clouddrive-local};
    mc anonymous set none local/${MINIO_BUCKET:-clouddrive-local};
    exit 0;
    "
  networks:
    - csp-dev-network
```

Add to top-level volumes:

```yaml
minio-dev-data:
```

- [ ] **Step 2: Add environment contract**

Append to `.env.example`:

```env
# Storage abstraction
STORAGE_DRIVER=qiniu

# MinIO local development
MINIO_ENDPOINT=http://localhost:9000
MINIO_REGION=us-east-1
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=clouddrive-local

# Upload pipeline
UPLOAD_SESSION_TTL_HOURS=24
UPLOAD_CHUNK_SIZE_BYTES=8388608
UPLOAD_MAX_CHUNK_SIZE_BYTES=16777216
UPLOAD_MIN_CHUNK_SIZE_BYTES=5242880
UPLOAD_DIRECT_THRESHOLD_BYTES=8388608
UPLOAD_PART_URL_TTL_SECONDS=3600
UPLOAD_CLIENT_MAX_ACTIVE_FILES=3
THUMBNAIL_MAX_RETRIES=5
```

- [ ] **Step 3: Add configuration and validation**

In `server/src/common/config/configuration.ts`, add:

```ts
storage: {
  driver: process.env.STORAGE_DRIVER || 'qiniu',
},
minio: {
  endpoint: process.env.MINIO_ENDPOINT || 'http://localhost:9000',
  region: process.env.MINIO_REGION || 'us-east-1',
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
  bucket: process.env.MINIO_BUCKET || 'clouddrive-local',
},
upload: {
  sessionTtlHours: Number(process.env.UPLOAD_SESSION_TTL_HOURS || 24),
  chunkSizeBytes: Number(process.env.UPLOAD_CHUNK_SIZE_BYTES || 8388608),
  maxChunkSizeBytes: Number(process.env.UPLOAD_MAX_CHUNK_SIZE_BYTES || 16777216),
  minChunkSizeBytes: Number(process.env.UPLOAD_MIN_CHUNK_SIZE_BYTES || 5242880),
  directThresholdBytes: Number(process.env.UPLOAD_DIRECT_THRESHOLD_BYTES || 8388608),
  partUrlTtlSeconds: Number(process.env.UPLOAD_PART_URL_TTL_SECONDS || 3600),
  clientMaxActiveFiles: Number(process.env.UPLOAD_CLIENT_MAX_ACTIVE_FILES || 3),
  thumbnailMaxRetries: Number(process.env.THUMBNAIL_MAX_RETRIES || 5),
},
```

In `configValidationSchema`, allow:

```ts
STORAGE_DRIVER: Joi.string().valid('minio', 'qiniu').required(),
MINIO_ENDPOINT: Joi.string().uri().when('STORAGE_DRIVER', {
  is: 'minio',
  then: Joi.required(),
  otherwise: Joi.optional(),
}),
MINIO_BUCKET: Joi.string().when('STORAGE_DRIVER', {
  is: 'minio',
  then: Joi.required(),
  otherwise: Joi.optional(),
}),
```

- [ ] **Step 4: Write failing driver selection test**

Create `server/test/storage/storage.service.spec.ts`:

```ts
import { StorageService } from '../../src/storage/storage.service';
import { MinioStorageDriver } from '../../src/storage/minio-storage.driver';
import { QiniuStorageDriver } from '../../src/storage/qiniu-storage.driver';

describe('StorageService', () => {
  it('selects the MinIO driver in local mode', () => {
    const service = new StorageService({
      driver: 'minio',
      minio: new MinioStorageDriver({
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        bucket: 'clouddrive-local',
      }),
      qiniu: new QiniuStorageDriver({
        endpoint: 'https://s3.cn-east-1.qiniucs.com',
        region: 'cn-east-1',
        accessKey: 'test',
        secretKey: 'test',
        bucket: 'test-bucket',
      }),
    });

    expect(service.driverName).toBe('minio');
  });

  it('selects the Qiniu driver in production mode', () => {
    const service = new StorageService({
      driver: 'qiniu',
      minio: new MinioStorageDriver({
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        bucket: 'clouddrive-local',
      }),
      qiniu: new QiniuStorageDriver({
        endpoint: 'https://s3.cn-east-1.qiniucs.com',
        region: 'cn-east-1',
        accessKey: 'test',
        secretKey: 'test',
        bucket: 'test-bucket',
      }),
    });

    expect(service.driverName).toBe('qiniu');
  });
});
```

- [ ] **Step 5: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/storage/storage.service.spec.ts
```

Expected: FAIL because storage classes do not exist.

- [ ] **Step 6: Implement storage abstraction**

Create `server/src/storage/storage-driver.ts`:

```ts
export interface DirectPutUrlInput {
  key: string;
  contentType: string;
  expiresInSeconds: number;
}

export interface CreateMultipartInput {
  key: string;
  contentType: string;
}

export interface PartPutUrlInput {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds: number;
}

export interface CompleteMultipartInput {
  key: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}

export interface AbortMultipartInput {
  key: string;
  uploadId: string;
}

export interface HeadObjectResult {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
}

export interface StorageDriver {
  readonly name: 'minio' | 'qiniu';
  createDirectPutUrl(input: DirectPutUrlInput): Promise<string>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  createMultipart(input: CreateMultipartInput): Promise<{ uploadId: string }>;
  createPartPutUrl(input: PartPutUrlInput): Promise<string>;
  completeMultipart(input: CompleteMultipartInput): Promise<{ key: string; etag?: string }>;
  abortMultipart(input: AbortMultipartInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
}
```

Create a shared `BaseS3StorageDriver` in `server/src/storage/base-s3-storage.driver.ts`:

```ts
import { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export abstract class BaseS3StorageDriver {
  protected constructor(
    protected readonly client: S3Client,
    protected readonly bucket: string,
  ) {}

  protected async presign(command: Parameters<typeof getSignedUrl>[1], expiresInSeconds: number) {
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
```

Implement `MinioStorageDriver` and `QiniuStorageDriver` by extending it. Both use the same S3 commands:

- `PutObjectCommand` for direct PUT;
- `HeadObjectCommand` for existence and size;
- `CreateMultipartUploadCommand`;
- `UploadPartCommand` presigning;
- `CompleteMultipartUploadCommand`;
- `AbortMultipartUploadCommand`;
- `DeleteObjectCommand`.

Configure both clients with:

```ts
forcePathStyle: true,
requestChecksumCalculation: 'WHEN_REQUIRED',
responseChecksumValidation: 'WHEN_REQUIRED',
```

Create `server/src/storage/storage.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { StorageDriver } from './storage-driver';

@Injectable()
export class StorageService {
  constructor(
    private readonly drivers: {
      driver: 'minio' | 'qiniu';
      minio: StorageDriver;
      qiniu: StorageDriver;
    },
  ) {}

  get driverName(): 'minio' | 'qiniu' {
    return this.drivers.driver;
  }

  private get driver(): StorageDriver {
    return this.drivers.driver === 'minio' ? this.drivers.minio : this.drivers.qiniu;
  }

  createDirectPutUrl(input: Parameters<StorageDriver['createDirectPutUrl']>[0]) {
    return this.driver.createDirectPutUrl(input);
  }

  headObject(key: string) {
    return this.driver.headObject(key);
  }

  createMultipart(input: Parameters<StorageDriver['createMultipart']>[0]) {
    return this.driver.createMultipart(input);
  }

  createPartPutUrl(input: Parameters<StorageDriver['createPartPutUrl']>[0]) {
    return this.driver.createPartPutUrl(input);
  }

  completeMultipart(input: Parameters<StorageDriver['completeMultipart']>[0]) {
    return this.driver.completeMultipart(input);
  }

  abortMultipart(input: Parameters<StorageDriver['abortMultipart']>[0]) {
    return this.driver.abortMultipart(input);
  }

  deleteObject(key: string) {
    return this.driver.deleteObject(key);
  }
}
```

Create `StorageModule` with a factory that reads `ConfigService`, constructs both drivers once, and exports `StorageService`.

- [ ] **Step 7: Verify local MinIO**

Run from repository root:

```bash
docker compose -f docker-compose.dev.yml up -d
curl -f http://localhost:9000/minio/health/live
```

Expected: curl returns success and MinIO console is reachable at `http://localhost:9001`.

- [ ] **Step 8: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/storage/storage.service.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 9: Commit**

```bash
git add docker-compose.dev.yml .env.example server/src server/test
git commit -m "feat(storage): add minio qiniu driver abstraction"
```

---

### Task 2: Upload, File Version, Folder, Object, and Quota Models

**Files:**

- Modify: `server/prisma/schema.prisma`
- Create: generated migration under `server/prisma/migrations/<timestamp>_upload_pipeline`

**Interfaces:**

- Consumes: Workspace model from the RBAC plan.
- Produces Prisma models `Folder`, `FileVersion`, `UploadSession`, `UploadChunk`, `StorageObject`, `WorkspaceQuota`, and related enums.

- [ ] **Step 1: Add upload pipeline schema**

Append or update in `server/prisma/schema.prisma`:

```prisma
enum UploadMode {
  direct
  multipart
}

enum UploadStrategy {
  normal
  instant
}

enum UploadSessionStatus {
  pending
  uploading
  merging
  completed
  failed
  canceled
  expired
}

enum UploadChunkStatus {
  pending
  uploaded
  failed
}

enum ThumbnailStatus {
  none
  pending
  processing
  done
  failed
}

enum StorageObjectStatus {
  available
  pending_delete
  deleted
}

model Folder {
  id          String   @id @default(uuid())
  workspaceId String   @map("workspace_id")
  parentId    String?  @map("parent_id")
  name        String   @db.VarChar(255)
  path        String   @db.VarChar(1024)
  createdBy   String   @map("created_by")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  workspace Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  parent    Folder?    @relation("FolderTree", fields: [parentId], references: [id])
  children  Folder[]   @relation("FolderTree")
  files     File[]

  @@unique([workspaceId, parentId, name])
  @@index([workspaceId, path])
  @@map("folders")
}

model File {
  id               String   @id @default(uuid())
  workspaceId      String   @map("workspace_id")
  folderId         String?  @map("folder_id")
  createdBy        String   @map("created_by")
  updatedBy        String   @map("updated_by")
  name             String   @db.VarChar(255)
  mimeType         String   @map("mime_type") @db.VarChar(255)
  extension        String?  @db.VarChar(32)
  size             BigInt
  hash             String?  @db.VarChar(128)
  hashAlgorithm    String   @default("sha256") @map("hash_algorithm") @db.VarChar(16)
  currentVersionId String?  @map("current_version_id")
  urlKey           String   @unique @map("url_key")
  visibility       String   @default("private")
  deletedAt        DateTime? @map("deleted_at")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  workspace Workspace       @relation(fields: [workspaceId], references: [id])
  folder    Folder?         @relation(fields: [folderId], references: [id])
  versions  FileVersion[]

  @@index([workspaceId, deletedAt, createdAt])
  @@index([workspaceId, folderId, name])
  @@map("files")
}

model FileVersion {
  id              String   @id @default(uuid())
  fileId          String   @map("file_id")
  versionNo       Int      @map("version_no")
  storageKey      String   @map("storage_key") @db.VarChar(1024)
  size            BigInt
  hash            String?  @db.VarChar(128)
  hashAlgorithm   String   @default("sha256") @map("hash_algorithm") @db.VarChar(16)
  mimeType        String   @map("mime_type") @db.VarChar(255)
  metadata        Json?
  thumbnailKey    String?  @map("thumbnail_key") @db.VarChar(1024)
  thumbnailStatus ThumbnailStatus @default(none)
  createdBy       String   @map("created_by")
  createdAt       DateTime @default(now()) @map("created_at")

  file File @relation(fields: [fileId], references: [id], onDelete: Cascade)

  @@unique([fileId, versionNo])
  @@index([hash])
  @@map("file_versions")
}

model StorageObject {
  id             String   @id @default(uuid())
  hashAlgorithm  String   @map("hash_algorithm") @db.VarChar(16)
  hash           String   @db.VarChar(128)
  size           BigInt
  storageDriver  String   @map("storage_driver") @db.VarChar(32)
  storageKey     String   @map("storage_key") @db.VarChar(1024)
  referenceCount Int      @default(0) @map("reference_count")
  status         StorageObjectStatus @default(available)
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  @@unique([storageDriver, hashAlgorithm, hash])
  @@index([storageDriver, status])
  @@map("storage_objects")
}

model UploadSession {
  id               String   @id @default(uuid())
  clientUploadId   String   @unique @map("client_upload_id")
  workspaceId      String   @map("workspace_id")
  folderId         String?  @map("folder_id")
  createdBy        String   @map("created_by")
  filename         String   @db.VarChar(255)
  mimeType         String   @map("mime_type") @db.VarChar(255)
  size             BigInt
  hash             String?  @db.VarChar(128)
  hashAlgorithm    String   @default("sha256") @map("hash_algorithm") @db.VarChar(16)
  chunkSize        Int      @map("chunk_size")
  totalChunks      Int      @map("total_chunks")
  uploadedChunks   Int      @default(0) @map("uploaded_chunks")
  mode             UploadMode
  strategy         UploadStrategy @default(normal)
  status           UploadSessionStatus @default(pending)
  storageKey       String   @map("storage_key") @db.VarChar(1024)
  providerUploadId String?  @map("provider_upload_id") @db.VarChar(255)
  quotaReserved    BigInt   @default(0) @map("quota_reserved")
  expiresAt        DateTime @map("expires_at")
  completedAt      DateTime? @map("completed_at")
  failureReason    String?  @map("failure_reason") @db.VarChar(1024)
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  workspace Workspace     @relation(fields: [workspaceId], references: [id])
  folder    Folder?       @relation(fields: [folderId], references: [id])
  chunks    UploadChunk[]

  @@index([workspaceId, createdBy, status])
  @@index([status, expiresAt])
  @@map("upload_sessions")
}

model UploadChunk {
  id              String   @id @default(uuid())
  uploadSessionId String   @map("upload_session_id")
  chunkIndex      Int      @map("chunk_index")
  size            BigInt
  etag            String?  @db.VarChar(255)
  status          UploadChunkStatus @default(pending)
  attemptCount    Int      @default(0) @map("attempt_count")
  uploadedAt      DateTime? @map("uploaded_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  session UploadSession @relation(fields: [uploadSessionId], references: [id], onDelete: Cascade)

  @@unique([uploadSessionId, chunkIndex])
  @@map("upload_chunks")
}

model WorkspaceQuota {
  id            String   @id @default(uuid())
  workspaceId   String   @unique @map("workspace_id")
  totalSize     BigInt   @map("total_size")
  usedSize      BigInt   @default(0) @map("used_size")
  reservedSize  BigInt   @default(0) @map("reserved_size")
  maxFileSize   BigInt   @map("max_file_size")
  maxFileCount  Int      @default(100000) @map("max_file_count")
  updatedAt     DateTime @updatedAt @map("updated_at")

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@map("workspace_quotas")
}
```

Add relations to `Workspace`:

```prisma
model Workspace {
  folders       Folder[]
  files         File[]
  uploadSessions UploadSession[]
  quota         WorkspaceQuota?
}
```

- [ ] **Step 2: Create and edit migration**

Run from `server/`:

```bash
DATABASE_URL="postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public" npx prisma migrate dev --create-only --name upload_pipeline
```

Edit the generated migration and place legacy File compatibility SQL after the new File columns exist but before non-null constraints are enforced:

```sql
UPDATE "files" SET
  "updated_by" = "created_by",
  "name" = "original_name",
  "mime_type" = "mime_type",
  "hash_algorithm" = 'sha256',
  "visibility" = CASE WHEN "is_private" THEN 'private' ELSE 'public' END
WHERE "updated_by" IS NULL;

INSERT INTO "workspace_quotas" (
  "id", "workspace_id", "total_size", "used_size", "reserved_size",
  "max_file_size", "max_file_count", "updated_at"
)
SELECT
  gen_random_uuid(),
  w."id",
  COALESCE(q."storage_limit", 10737418240),
  COALESCE(q."storage_used", 0),
  0,
  COALESCE(q."storage_limit", 10737418240),
  100000,
  now()
FROM "workspaces" w
LEFT JOIN "user_quotas" q ON q."user_id" = w."owner_id";
```

Then apply:

```bash
DATABASE_URL="postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public" npx prisma migrate dev
DATABASE_URL="postgresql://csp_user:csp_password_2024@localhost:5433/cloud_storage?schema=public" npx prisma generate
```

- [ ] **Step 3: Verify invariants**

Run PostgreSQL checks:

```sql
SELECT count(*) FROM workspace_quotas WHERE total_size < 0;
SELECT count(*) FROM upload_sessions WHERE total_chunks < 1;
SELECT count(*) FROM upload_chunks WHERE chunk_index < 1;
SELECT count(*) FROM file_versions WHERE version_no < 1;
```

Expected: all counts are `0`.

- [ ] **Step 4: Commit**

```bash
git add server/prisma
git commit -m "feat(upload): add persistent upload and version schema"
```

---

### Task 3: Transactional Workspace Quota Service

**Files:**

- Create: `server/src/quota/quota.service.ts`
- Create: `server/src/quota/quota.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/quota/quota.service.spec.ts`

**Interfaces:**

- Consumes: `PrismaService`.
- Produces:

```ts
class QuotaService {
  reserve(input: { workspaceId: string; size: BigInt }): Promise<void>;
  confirm(input: { workspaceId: string; uploadSessionId: string; size: BigInt }): Promise<void>;
  release(input: { workspaceId: string; uploadSessionId: string; size: BigInt }): Promise<void>;
  getUsage(workspaceId: string): Promise<QuotaUsage>;
}
```

- [ ] **Step 1: Write failing concurrency test**

Create `server/test/quota/quota.service.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { QuotaService } from '../../src/quota/quota.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('QuotaService', () => {
  it('rejects reservation when used plus reserved plus size exceeds total', async () => {
    const tx = {
      workspaceQuota: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: 'w1',
          totalSize: BigInt(100),
          usedSize: BigInt(80),
          reservedSize: BigInt(20),
        }),
      },
    };
    const prisma = { $transaction: jest.fn((fn) => fn(tx)) } as unknown as PrismaService;
    const service = new QuotaService(prisma);

    await expect(service.reserve({ workspaceId: 'w1', size: BigInt(1) })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reserves available quota', async () => {
    const update = jest.fn().mockResolvedValue({
      usedSize: BigInt(10),
      reservedSize: BigInt(20),
      totalSize: BigInt(100),
    });
    const tx = {
      workspaceQuota: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: 'w1',
          totalSize: BigInt(100),
          usedSize: BigInt(10),
          reservedSize: BigInt(10),
        }),
        update,
      },
    };
    const prisma = { $transaction: jest.fn((fn) => fn(tx)) } as unknown as PrismaService;
    const service = new QuotaService(prisma);

    await service.reserve({ workspaceId: 'w1', size: BigInt(10) });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { reservedSize: { increment: BigInt(10) } },
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/quota/quota.service.spec.ts
```

Expected: FAIL because `QuotaService` does not exist.

- [ ] **Step 3: Implement QuotaService**

Create `server/src/quota/quota.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAvailable(
    row: { totalSize: BigInt; usedSize: BigInt; reservedSize: BigInt },
    size: BigInt,
  ) {
    const available = row.totalSize - row.usedSize - row.reservedSize;
    if (size > available) {
      throw new BadRequestException('WORKSPACE_QUOTA_EXCEEDED');
    }
  }

  async reserve(input: { workspaceId: string; size: BigInt }) {
    await this.prisma.$transaction(async (tx) => {
      const quota = await tx.workspaceQuota.findUnique({
        where: { workspaceId: input.workspaceId },
      });

      if (!quota) throw new NotFoundException('WORKSPACE_QUOTA_NOT_FOUND');
      if (input.size > quota.maxFileSize) throw new BadRequestException('FILE_TOO_LARGE');
      this.assertAvailable(quota, input.size);

      await tx.workspaceQuota.update({
        where: { workspaceId: input.workspaceId },
        data: { reservedSize: { increment: input.size } },
      });
    });
  }

  async confirm(input: { workspaceId: string; uploadSessionId: string; size: BigInt }) {
    await this.prisma.$transaction(async (tx) => {
      const quota = await tx.workspaceQuota.findUnique({
        where: { workspaceId: input.workspaceId },
      });
      if (!quota) throw new NotFoundException('WORKSPACE_QUOTA_NOT_FOUND');

      await tx.workspaceQuota.update({
        where: { workspaceId: input.workspaceId },
        data: {
          usedSize: { increment: input.size },
          reservedSize: { decrement: input.size },
        },
      });

      await tx.uploadSession.update({
        where: { id: input.uploadSessionId },
        data: { quotaReserved: BigInt(0) },
      });
    });
  }

  async release(input: { workspaceId: string; uploadSessionId: string; size: BigInt }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceQuota.update({
        where: { workspaceId: input.workspaceId },
        data: { reservedSize: { decrement: input.size } },
      });

      await tx.uploadSession.update({
        where: { id: input.uploadSessionId },
        data: { quotaReserved: BigInt(0) },
      });
    });
  }

  async getUsage(workspaceId: string) {
    const quota = await this.prisma.workspaceQuota.findUnique({ where: { workspaceId } });
    if (!quota) throw new NotFoundException('WORKSPACE_QUOTA_NOT_FOUND');

    return {
      totalSize: Number(quota.totalSize),
      usedSize: Number(quota.usedSize),
      reservedSize: Number(quota.reservedSize),
      availableSize: Number(quota.totalSize - quota.usedSize - quota.reservedSize),
      maxFileSize: Number(quota.maxFileSize),
      maxFileCount: quota.maxFileCount,
    };
  }
}
```

Create `server/src/quota/quota.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { QuotaService } from './quota.service';

@Module({
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
```

- [ ] **Step 4: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/quota/quota.service.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/quota server/src/app.module.ts server/test/quota
git commit -m "feat(quota): reserve confirm and release upload quota"
```

---

### Task 4: Upload Session Creation and Instant Upload Detection

**Files:**

- Create: `server/src/upload/dto/create-upload-session.dto.ts`
- Create: `server/src/upload/upload.service.ts`
- Create: `server/src/upload/upload.controller.ts`
- Create: `server/src/upload/upload.module.ts`
- Modify: `server/src/app.module.ts`
- Test: `server/test/upload/upload-session.service.spec.ts`

**Interfaces:**

- Consumes: `WorkspacesService`, `QuotaService`, `StorageService`, `AuditService`.
- Produces:

```ts
class UploadService {
  createSession(
    actor: WorkspaceActorContext,
    dto: CreateUploadSessionDto,
  ): Promise<CreateSessionResponse>;
  getResume(actor: WorkspaceActorContext, uploadSessionId: string): Promise<ResumeResponse>;
}
```

- [ ] **Step 1: Add DTO contract**

Create `server/src/upload/dto/create-upload-session.dto.ts`:

```ts
import {
  IsIn,
  IsInt,
  IsMD5,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateUploadSessionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  mimeType!: string;

  @IsNumber()
  @Min(1)
  size!: number;

  @IsOptional()
  @IsString()
  @Length(64, 64)
  hash?: string;

  @IsOptional()
  @IsIn(['sha256'])
  hashAlgorithm: string = 'sha256';

  @IsOptional()
  @IsUUID()
  folderId?: string;

  @IsOptional()
  @IsString()
  clientUploadId?: string;

  @IsOptional()
  @IsInt()
  @Min(5242880)
  @Max(16777216)
  chunkSize?: number;
}

export class CompleteSessionDto {
  @IsOptional()
  @IsString()
  @Length(64, 64)
  hash?: string;

  @IsOptional()
  parts?: { partNumber: number; etag: string }[];
}
```

Import `Length` from `class-validator`.

- [ ] **Step 2: Write failing session creation tests**

Create `server/test/upload/upload-session.service.spec.ts`:

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  storageObject: { findUnique: jest.fn() },
  uploadChunk: { createMany: jest.fn(), findMany: jest.fn() },
  file: { create: jest.fn() },
  fileVersion: { create: jest.fn() },
  $transaction: jest.fn(),
};
const quota = { reserve: jest.fn(), confirm: jest.fn(), release: jest.fn() };
const storage = { createMultipart: jest.fn() };
const audit = { record: jest.fn() };
const workspaces = { requireMembership: jest.fn() };

describe('UploadService session creation', () => {
  let service: UploadService;
  const actor = { userId: 'u1', workspaceId: 'w1', memberId: 'm1', role: 'EDITOR' as const };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
    );
  });

  it('creates instant strategy when hash and size match an available object', async () => {
    prisma.storageObject.findUnique.mockResolvedValue({
      id: 'object-1',
      hash: 'a'.repeat(64),
      size: BigInt(8),
      status: 'available',
      storageKey: 'objects/a',
    });
    prisma.uploadSession.create.mockResolvedValue({
      id: 'session-1',
      clientUploadId: 'client-1',
      mode: 'direct',
      strategy: 'instant',
      chunkSize: 8388608,
      totalChunks: 1,
      uploadedChunks: 0,
      expiresAt: new Date(),
    });

    const result = await service.createSession(actor, {
      filename: 'a.txt',
      mimeType: 'text/plain',
      size: 8,
      hash: 'a'.repeat(64),
    });

    expect(result.strategy).toBe('instant');
    expect(quota.reserve).toHaveBeenCalledWith({ workspaceId: 'w1', size: BigInt(8) });
  });

  it('rejects an invalid folder', async () => {
    prisma.storageObject.findUnique.mockResolvedValue(null);
    prisma.uploadSession.create.mockRejectedValue(new Error('foreign key'));

    await expect(
      service.createSession(actor, {
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 8,
        folderId: 'missing',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/upload/upload-session.service.spec.ts
```

Expected: FAIL because `UploadService` does not exist.

- [ ] **Step 4: Implement session creation**

Create `server/src/upload/upload.service.ts`:

```ts
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { WorkspaceActorContext } from '../workspaces/types';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';

const BYTES_PER_MB = 1024 * 1024;

@Injectable()
export class UploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  private extension(filename: string): string {
    const index = filename.lastIndexOf('.');
    return index > 0
      ? filename
          .slice(index + 1)
          .toLowerCase()
          .slice(0, 32)
      : '';
  }

  private storageKey(workspaceId: string, filename: string) {
    const now = new Date();
    const key = `${workspaceId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const ext = this.extension(filename);
    return ext ? `${key}.${ext}` : key;
  }

  async createSession(actor: WorkspaceActorContext, dto: CreateUploadSessionDto) {
    if (dto.filename.includes('/') || dto.filename.includes('\\')) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const size = BigInt(Math.ceil(dto.size));
    const chunkSize = dto.chunkSize ?? 8 * BYTES_PER_MB;
    const totalChunks = Math.max(1, Math.ceil(dto.size / chunkSize));
    const clientUploadId = dto.clientUploadId ?? randomUUID();
    const strategy =
      dto.hash && dto.hashAlgorithm === 'sha256'
        ? (
            await this.prisma.storageObject.findUnique({
              where: {
                storageDriver_hashAlgorithm_hash: {
                  storageDriver: this.storageService.driverName,
                  hashAlgorithm: dto.hashAlgorithm,
                  hash: dto.hash.toLowerCase(),
                },
              },
            })
          )?.status === 'available'
          ? 'instant'
          : 'normal'
        : 'normal';

    try {
      await this.quotaService.reserve({ workspaceId: actor.workspaceId, size });

      const session = await this.prisma.uploadSession.create({
        data: {
          clientUploadId,
          workspaceId: actor.workspaceId,
          folderId: dto.folderId,
          createdBy: actor.userId,
          filename: dto.filename,
          mimeType: dto.mimeType,
          size,
          hash: dto.hash?.toLowerCase(),
          hashAlgorithm: dto.hashAlgorithm,
          chunkSize,
          totalChunks,
          mode: dto.size <= 8 * BYTES_PER_MB ? 'direct' : 'multipart',
          strategy,
          status: strategy === 'instant' ? 'merging' : 'pending',
          storageKey: this.storageKey(actor.workspaceId, dto.filename),
          quotaReserved: size,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      if (session.mode === 'multipart') {
        if (strategy === 'instant') {
          session.providerUploadId = null;
        } else {
          const multipart = await this.storageService.createMultipart({
            key: session.storageKey,
            contentType: dto.mimeType,
          });
          await this.prisma.uploadSession.update({
            where: { id: session.id },
            data: { providerUploadId: multipart.uploadId },
          });
          await this.prisma.uploadChunk.createMany({
            data: Array.from({ length: totalChunks }, (_, index) => ({
              uploadSessionId: session.id,
              chunkIndex: index + 1,
              size:
                index === totalChunks - 1
                  ? size - BigInt((totalChunks - 1) * chunkSize)
                  : BigInt(chunkSize),
            })),
          });
        }
      }

      await this.auditService.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: 'upload.created',
        resourceType: 'upload',
        resourceId: session.id,
        after: { filename: dto.filename, size: Number(size), strategy },
      });

      return {
        uploadSessionId: session.id,
        clientUploadId,
        mode: session.mode,
        strategy,
        chunkSize,
        totalChunks,
        uploadedChunks: [] as number[],
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      await this.quotaService
        .release({
          workspaceId: actor.workspaceId,
          uploadSessionId: clientUploadId,
          size,
        })
        .catch(() => undefined);
      throw error;
    }
  }

  async getResume(actor: WorkspaceActorContext, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: uploadSessionId, workspaceId: actor.workspaceId },
      include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
    });

    if (session?.status === 'expired') {
      throw new HttpException({ code: 'UPLOAD_SESSION_EXPIRED' }, 410);
    }

    if (!session) throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND');
    if (session.createdBy !== actor.userId && !['OWNER', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    const uploadedChunks = session.chunks
      .filter((chunk) => chunk.status === 'uploaded')
      .map((chunk) => chunk.chunkIndex);
    const missingChunks = session.chunks
      .filter((chunk) => chunk.status !== 'uploaded')
      .map((chunk) => chunk.chunkIndex);

    return {
      uploadSessionId: session.id,
      status: session.status,
      strategy: session.strategy,
      mode: session.mode,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedChunks,
      missingChunks,
      expiresAt: session.expiresAt,
    };
  }
}
```

Import `WorkspacesService` from `../workspaces/workspaces.service`.

- [ ] **Step 5: Add controller and module**

Create `server/src/upload/upload.controller.ts`:

```ts
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard, PermissionGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { UploadService } from './upload.service';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';

@Controller('workspaces/:workspaceId/upload/sessions')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  create(@WorkspaceActor() actor: WorkspaceActorContext, @Body() dto: CreateUploadSessionDto) {
    return this.uploadService.createSession(actor, dto);
  }

  @Get(':uploadSessionId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  resume(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
    return this.uploadService.getResume(actor, id);
  }
}
```

Create `UploadModule`, import `WorkspacesModule`, `QuotaModule`, `StorageModule`, and `AuditModule`, register the controller, export `UploadService`, and register `UploadModule` in `AppModule`.

- [ ] **Step 6: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/upload/upload-session.service.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/upload server/src/app.module.ts server/test/upload
git commit -m "feat(upload): create resumable sessions and instant detection"
```

---

### Task 5: Direct Upload, Instant Confirm, Chunk URLs, Chunk Confirm, and Merge

**Files:**

- Modify: `server/src/upload/dto/create-upload-session.dto.ts`
- Modify: `server/src/upload/upload.service.ts`
- Modify: `server/src/upload/upload.controller.ts`
- Test: `server/test/upload/upload-completion.service.spec.ts`
- Test: `server/test/upload/upload-chunk.service.spec.ts`

**Interfaces:**

- Consumes: `UploadService`, `StorageService`, `QuotaService`, `AuditService`.
- Produces:

```ts
createDirectUrl(actor: WorkspaceActorContext, uploadSessionId: string): Promise<{ uploadUrl: string; expiresAt: Date }>;
confirmInstant(actor: WorkspaceActorContext, uploadSessionId: string): Promise<UploadCompletedResponse>;
createChunkUrls(actor: WorkspaceActorContext, uploadSessionId: string, chunkIndexes: number[]): Promise<ChunkUrlResponse[]>;
confirmChunk(actor: WorkspaceActorContext, uploadSessionId: string, chunkIndex: number, etag: string): Promise<{ chunkIndex: number; uploadedChunks: number }>;
complete(actor: WorkspaceActorContext, uploadSessionId: string, dto: CompleteSessionDto): Promise<UploadCompletedResponse>;
cancel(actor: WorkspaceActorContext, uploadSessionId: string): Promise<{ id: string }>;
```

- [ ] **Step 1: Add DTOs**

Append to `server/src/upload/dto/create-upload-session.dto.ts`:

```ts
export class DirectUrlDto {}

export class InstantConfirmDto {}

export class ChunkUrlRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsInt({ each: true })
  @Min(1, { each: true })
  chunkIndexes!: number[];
}

export class ConfirmChunkDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  etag!: string;
}

export class CancelSessionDto {}
```

Import `ArrayMaxSize`, `ArrayMinSize`, and `IsArray`.

- [ ] **Step 2: Write failing completion tests**

Create `server/test/upload/upload-completion.service.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  uploadChunk: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  storageObject: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  file: { create: jest.fn() },
  fileVersion: { create: jest.fn() },
  $transaction: jest.fn((fn) =>
    fn({
      uploadSession: prisma.uploadSession,
      uploadChunk: prisma.uploadChunk,
      storageObject: prisma.storageObject,
      file: prisma.file,
      fileVersion: prisma.fileVersion,
    }),
  ),
};
const quota = { confirm: jest.fn(), release: jest.fn() };
const storage = { headObject: jest.fn(), completeMultipart: jest.fn(), abortMultipart: jest.fn() };
const audit = { record: jest.fn() };
const workspaces = { requireMembership: jest.fn() };

describe('UploadService completion', () => {
  let service: UploadService;
  const actor = { userId: 'u1', workspaceId: 'w1', memberId: 'm1', role: 'EDITOR' as const };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
    );
  });

  it('rejects completion when direct object is missing', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      createdBy: 'u1',
      mode: 'direct',
      status: 'uploading',
      size: BigInt(8),
      storageKey: 'key',
      hash: null,
      chunks: [],
    });
    storage.headObject.mockResolvedValue(null);

    await expect(service.complete(actor, 's1', {})).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate completion idempotently with completed response', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      status: 'completed',
      mode: 'direct',
      workspaceId: 'w1',
      createdBy: 'u1',
      size: BigInt(8),
      storageKey: 'key',
      chunks: [],
      file: { id: 'file-1', urlKey: 'abc' },
    });

    const result = await service.complete(actor, 's1', {});

    expect(result).toMatchObject({ fileId: 'file-1', urlKey: 'abc' });
  });

  it('rejects merge when chunk state is incomplete', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      status: 'uploading',
      mode: 'multipart',
      workspaceId: 'w1',
      createdBy: 'u1',
      totalChunks: 3,
      size: BigInt(30),
      storageKey: 'key',
      providerUploadId: 'mp-1',
      chunks: [
        { chunkIndex: 1, status: 'uploaded', etag: 'e1', size: BigInt(10) },
        { chunkIndex: 2, status: 'uploaded', etag: 'e2', size: BigInt(10) },
      ],
    });

    await expect(service.complete(actor, 's1', {})).rejects.toThrow(ConflictException);
  });
});
```

Create `server/test/upload/upload-chunk.service.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { findFirst: jest.fn(), update: jest.fn() },
  uploadChunk: { findUnique: jest.fn(), update: jest.fn() },
  storageObject: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  file: { create: jest.fn() },
  fileVersion: { create: jest.fn() },
  $transaction: jest.fn((fn) =>
    fn({
      uploadSession: prisma.uploadSession,
      uploadChunk: prisma.uploadChunk,
    }),
  ),
};
const quota = { confirm: jest.fn(), release: jest.fn() };
const storage = { createPartPutUrl: jest.fn().mockResolvedValue('https://signed') };
const audit = { record: jest.fn() };
const workspaces = { requireMembership: jest.fn() };

describe('UploadService chunk handling', () => {
  const actor = { userId: 'u1', workspaceId: 'w1', memberId: 'm1', role: 'EDITOR' as const };

  it('returns deterministic signed URL for one chunk', async () => {
    const service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
    );
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      createdBy: 'u1',
      mode: 'multipart',
      status: 'uploading',
      storageKey: 'key',
      providerUploadId: 'mp-1',
      expiresAt: new Date(Date.now() + 1000),
    });

    const result = await service.createChunkUrls(actor, 's1', [1]);
    expect(result[0]).toMatchObject({ chunkIndex: 1, uploadUrl: 'https://signed' });
  });

  it('keeps chunk confirm idempotent', async () => {
    const service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
    );
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      createdBy: 'u1',
      status: 'uploading',
      totalChunks: 1,
    });
    prisma.uploadChunk.findUnique.mockResolvedValue({
      chunkIndex: 1,
      status: 'uploaded',
      etag: 'same',
      size: BigInt(8),
    });

    const result = await service.confirmChunk(actor, 's1', 1, 'same');
    expect(result).toMatchObject({ chunkIndex: 1 });
    expect(prisma.uploadChunk.update).not.toHaveBeenCalled();
  });

  it('rejects invalid chunk index', async () => {
    const service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
    );
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      createdBy: 'u1',
      status: 'uploading',
      totalChunks: 1,
    });
    prisma.uploadChunk.findUnique.mockResolvedValue(null);

    await expect(service.confirmChunk(actor, 's1', 2, 'etag')).rejects.toThrow(ConflictException);
  });
});
```

- [ ] **Step 3: Run tests and verify they fail**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/upload/upload-completion.service.spec.ts test/upload/upload-chunk.service.spec.ts
```

Expected: FAIL because the new methods do not exist.

- [ ] **Step 4: Implement ownership guard helper**

Add to `UploadService`:

```ts
private async requireSession(actor: WorkspaceActorContext, uploadSessionId: string) {
  const session = await this.prisma.uploadSession.findFirst({
    where: { id: uploadSessionId, workspaceId: actor.workspaceId },
    include: { chunks: { orderBy: { chunkIndex: 'asc' } }, file: true },
  });

  if (!session) throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND');
  if (session.createdBy !== actor.userId && !['OWNER', 'ADMIN'].includes(actor.role)) {
    throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
  }
  return session;
}
```

- [ ] **Step 5: Implement direct URL, instant, cancel, and chunk URL methods**

Add to `UploadService`:

```ts
async createDirectUrl(actor: WorkspaceActorContext, uploadSessionId: string) {
  const session = await this.requireSession(actor, uploadSessionId);
  if (session.mode !== 'direct') throw new ConflictException('UPLOAD_SESSION_MODE_INVALID');
  if (session.status !== 'pending' && session.status !== 'uploading') {
    throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const uploadUrl = await this.storageService.createDirectPutUrl({
    key: session.storageKey,
    contentType: session.mimeType,
    expiresInSeconds: 900,
  });

  await this.prisma.uploadSession.update({
    where: { id: session.id },
    data: { status: 'uploading' },
  });

  return { uploadUrl, expiresAt };
}

async cancel(actor: WorkspaceActorContext, uploadSessionId: string) {
  const session = await this.requireSession(actor, uploadSessionId);
  if (['completed', 'canceled', 'expired'].includes(session.status)) {
    throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
  }

  if (session.mode === 'multipart' && session.providerUploadId) {
    await this.storageService.abortMultipart({
      key: session.storageKey,
      uploadId: session.providerUploadId,
    });
  }

  await this.prisma.uploadSession.update({
    where: { id: session.id },
    data: { status: 'canceled', failureReason: 'canceled_by_user' },
  });

  if (session.quotaReserved > BigInt(0)) {
    await this.quotaService.release({
      workspaceId: session.workspaceId,
      uploadSessionId: session.id,
      size: session.quotaReserved,
    });
  }

  await this.auditService.record({
    workspaceId: session.workspaceId,
    actorId: actor.userId,
    action: 'upload.canceled',
    resourceType: 'upload',
    resourceId: session.id,
  });

  return { id: session.id };
}

async createChunkUrls(actor: WorkspaceActorContext, uploadSessionId: string, chunkIndexes: number[]) {
  const session = await this.requireSession(actor, uploadSessionId);
  if (session.mode !== 'multipart' || !session.providerUploadId) {
    throw new ConflictException('UPLOAD_SESSION_MODE_INVALID');
  }

  const unique = [...new Set(chunkIndexes)].sort((a, b) => a - b);
  const urls = await Promise.all(unique.map(async chunkIndex => ({
    chunkIndex,
    uploadUrl: await this.storageService.createPartPutUrl({
      key: session.storageKey,
      uploadId: session.providerUploadId as string,
      partNumber: chunkIndex,
      expiresInSeconds: 3600,
    }),
    expiresAt: new Date(Date.now() + 3600 * 1000),
  })));

  await this.prisma.uploadSession.update({
    where: { id: session.id },
    data: { status: 'uploading' },
  });

  return urls;
}
```

- [ ] **Step 6: Implement chunk confirmation**

Add to `UploadService`:

```ts
async confirmChunk(actor: WorkspaceActorContext, uploadSessionId: string, chunkIndex: number, etag: string) {
  const session = await this.requireSession(actor, uploadSessionId);
  if (session.status !== 'uploading' && session.status !== 'pending') {
    throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
  }

  const chunk = await this.prisma.uploadChunk.findUnique({
    where: { uploadSessionId_chunkIndex: { uploadSessionId: session.id, chunkIndex } },
  });

  if (!chunk) throw new ConflictException('UPLOAD_CHUNK_INVALID');

  if (chunk.status === 'uploaded' && chunk.etag === etag) {
    return { chunkIndex, uploadedChunks: session.uploadedChunks };
  }

  const updated = await this.prisma.$transaction(async tx => {
    const result = await tx.uploadChunk.update({
      where: { id: chunk.id },
      data: { status: 'uploaded', etag, uploadedAt: new Date() },
    });

    return tx.uploadSession.update({
      where: { id: session.id },
      data: { uploadedChunks: { increment: 1 } },
      include: { chunks: true },
    });
  });

  return {
    chunkIndex,
    uploadedChunks: updated.uploadedChunks,
  };
}
```

- [ ] **Step 7: Implement completion and instant upload**

Add a private file creation method to `UploadService`:

```ts
private async createFileAndVersion(input: {
  actor: WorkspaceActorContext;
  session: {
    id: string; workspaceId: string; folderId: string | null; createdBy: string;
    filename: string; mimeType: string; size: BigInt; hash: string | null;
    hashAlgorithm: string; storageKey: string;
  };
}) {
  const file = await this.prisma.file.create({
    data: {
      workspaceId: input.session.workspaceId,
      folderId: input.session.folderId,
      createdBy: input.actor.userId,
      updatedBy: input.actor.userId,
      name: input.session.filename,
      mimeType: input.session.mimeType,
      extension: this.extension(input.session.filename),
      size: input.session.size,
      hash: input.session.hash,
      hashAlgorithm: input.session.hashAlgorithm,
      urlKey: randomUUID().replace(/-/g, ''),
      visibility: 'private',
    },
  });

  const version = await this.prisma.fileVersion.create({
    data: {
      fileId: file.id,
      versionNo: 1,
      storageKey: input.session.storageKey,
      size: input.session.size,
      hash: input.session.hash,
      hashAlgorithm: input.session.hashAlgorithm,
      mimeType: input.session.mimeType,
      createdBy: input.actor.userId,
    },
  });

  await this.prisma.file.update({
    where: { id: file.id },
    data: { currentVersionId: version.id },
  });

  return { file, version };
}

private async upsertStorageObject(session: {
  workspaceId: string; hash: string | null; hashAlgorithm: string; size: BigInt; storageKey: string;
}) {
  if (!session.hash) {
    await this.prisma.storageObject.create({
      data: {
        hashAlgorithm: session.hashAlgorithm,
        hash: `unverified:${session.storageKey}`,
        size: session.size,
        storageDriver: this.storageService.driverName,
        storageKey: session.storageKey,
        referenceCount: 1,
      },
    });
    return;
  }

  const object = await this.prisma.storageObject.findUnique({
    where: {
      storageDriver_hashAlgorithm_hash: {
        storageDriver: this.storageService.driverName,
        hashAlgorithm: session.hashAlgorithm,
        hash: session.hash,
      },
    },
  });

  if (object) {
    await this.prisma.storageObject.update({
      where: { id: object.id },
      data: { referenceCount: { increment: 1 } },
    });
    return;
  }

  await this.prisma.storageObject.create({
    data: {
      hashAlgorithm: session.hashAlgorithm,
      hash: session.hash,
      size: session.size,
      storageDriver: this.storageService.driverName,
      storageKey: session.storageKey,
      referenceCount: 1,
    },
  });
}
```

Add `complete`:

```ts
async complete(actor: WorkspaceActorContext, uploadSessionId: string, dto: CompleteSessionDto) {
  const session = await this.requireSession(actor, uploadSessionId);

  if (session.status === 'completed' && session.file) {
    return {
      fileId: session.file.id,
      urlKey: session.file.urlKey,
      name: session.file.name,
      size: Number(session.size),
      strategy: session.strategy,
    };
  }

  if (['failed', 'canceled', 'expired'].includes(session.status)) {
    throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
  }

  await this.prisma.uploadSession.update({
    where: { id: session.id },
    data: { status: 'merging' },
  });

  try {
    if (session.mode === 'multipart') {
      const incomplete = session.chunks.length !== session.totalChunks ||
        session.chunks.some(chunk => chunk.status !== 'uploaded');
      if (incomplete || !session.providerUploadId) {
        throw new ConflictException('UPLOAD_CHUNK_INVALID');
      }

      await this.storageService.completeMultipart({
        key: session.storageKey,
        uploadId: session.providerUploadId,
        parts: session.chunks.map(chunk => ({
          partNumber: chunk.chunkIndex,
          etag: chunk.etag as string,
        })),
      });
    }

    const object = await this.storageService.headObject(session.storageKey);
    if (!object || object.size !== Number(session.size)) {
      throw new NotFoundException('UPLOAD_OBJECT_SIZE_MISMATCH');
    }

    const effectiveHash = dto.hash?.toLowerCase() ?? session.hash;
    const effectiveSession = { ...session, hash: effectiveHash };

    await this.prisma.$transaction(async tx => {
      await tx.uploadSession.update({
        where: { id: session.id },
        data: { hash: effectiveHash, status: 'completed', completedAt: new Date() },
      });
      return effectiveSession;
    });

    await this.upsertStorageObject(effectiveSession);
    const created = await this.createFileAndVersion({ actor, session: effectiveSession });

    await this.prisma.file.update({
      where: { id: created.file.id },
      data: { currentVersionId: created.version.id },
    });

    await this.quotaService.confirm({
      workspaceId: session.workspaceId,
      uploadSessionId: session.id,
      size: session.size,
    });

    await this.auditService.record({
      workspaceId: session.workspaceId,
      actorId: actor.userId,
      action: session.strategy === 'instant' ? 'file.instant_uploaded' : 'file.uploaded',
      resourceType: 'file',
      resourceId: created.file.id,
      after: { uploadSessionId: session.id, size: Number(session.size), hash: effectiveHash },
    });

    return {
      fileId: created.file.id,
      urlKey: created.file.urlKey,
      name: created.file.name,
      size: Number(session.size),
      strategy: session.strategy,
    };
  } catch (error) {
    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'failed', failureReason: (error as Error).message.slice(0, 1000) },
    });
    throw error;
  }
}
```

Add `confirmInstant`:

```ts
async confirmInstant(actor: WorkspaceActorContext, uploadSessionId: string) {
  const session = await this.requireSession(actor, uploadSessionId);

  if (session.status === 'completed' && session.file) {
    return { fileId: session.file.id, urlKey: session.file.urlKey };
  }
  if (session.strategy !== 'instant') {
    throw new ConflictException('UPLOAD_INSTANT_NOT_AVAILABLE');
  }
  if (!session.hash) {
    throw new ConflictException('UPLOAD_HASH_REQUIRED');
  }

  const object = await this.prisma.storageObject.findUnique({
    where: {
      storageDriver_hashAlgorithm_hash: {
        storageDriver: this.storageService.driverName,
        hashAlgorithm: session.hashAlgorithm,
        hash: session.hash,
      },
    },
  });

  if (!object || object.status !== 'available' || object.size !== session.size) {
    throw new ConflictException('UPLOAD_INSTANT_NOT_AVAILABLE');
  }

  await this.prisma.storageObject.update({
    where: { id: object.id },
    data: { referenceCount: { increment: 1 } },
  });

  const created = await this.createFileAndVersion({ actor, session });

  await this.prisma.uploadSession.update({
    where: { id: session.id },
    data: { status: 'completed', completedAt: new Date() },
  });

  await this.quotaService.confirm({
    workspaceId: session.workspaceId,
    uploadSessionId: session.id,
    size: session.size,
  });

  await this.auditService.record({
    workspaceId: session.workspaceId,
    actorId: actor.userId,
    action: 'file.instant_uploaded',
    resourceType: 'file',
    resourceId: created.file.id,
    after: { storageObjectId: object.id, size: Number(session.size) },
  });

  return {
    fileId: created.file.id,
    urlKey: created.file.urlKey,
    name: created.file.name,
    size: Number(session.size),
    strategy: 'instant',
  };
}
```

- [ ] **Step 8: Add routes**

Add to `UploadController`:

```ts
@Post(':uploadSessionId/direct-url')
@UseGuards(WorkspaceGuard, PermissionGuard)
@RequirePermission('file:upload')
directUrl(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
  return this.uploadService.createDirectUrl(actor, id);
}

@Post(':uploadSessionId/instant')
@UseGuards(WorkspaceGuard, PermissionGuard)
@RequirePermission('file:upload')
instant(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
  return this.uploadService.confirmInstant(actor, id);
}

@Post(':uploadSessionId/chunk-urls')
@UseGuards(WorkspaceGuard, PermissionGuard)
@RequirePermission('file:upload')
chunkUrls(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string, @Body() dto: ChunkUrlRequestDto) {
  return this.uploadService.createChunkUrls(actor, id, dto.chunkIndexes);
}

@Post(':uploadSessionId/chunks/:chunkIndex/complete')
@UseGuards(WorkspaceGuard, PermissionGuard)
@RequirePermission('file:upload')
confirmChunk(
  @WorkspaceActor() actor: WorkspaceActorContext,
  @Param('uploadSessionId') id: string,
  @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
  @Body() dto: ConfirmChunkDto,
) {
  return this.uploadService.confirmChunk(actor, id, chunkIndex, dto.etag);
}

@Post(':uploadSessionId/complete')
@UseGuards(WorkspaceGuard, PermissionGuard)
@RequirePermission('file:upload')
complete(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string, @Body() dto: CompleteSessionDto) {
  return this.uploadService.complete(actor, id, dto);
}

@Delete(':uploadSessionId/cancel')
@UseGuards(WorkspaceGuard, PermissionGuard)
@RequirePermission('file:upload')
cancel(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
  return this.uploadService.cancel(actor, id);
}
```

Import `ParseIntPipe` from `@nestjs/common`.

- [ ] **Step 9: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/upload/upload-completion.service.spec.ts test/upload/upload-chunk.service.spec.ts
npm run typecheck
```

Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add server/src/upload server/test/upload
git commit -m "feat(upload): direct multipart instant and retry flows"
```

---

### Task 6: Session Expiry Cleanup and Distributed Merge Lock

**Files:**

- Create: `server/src/upload/upload-expiration.service.ts`
- Modify: `server/src/upload/upload.service.ts`
- Create: `server/src/upload/cron/register-upload-cron.ts`
- Modify: `server/src/upload/upload.module.ts`
- Test: `server/test/upload/upload-expiration.service.spec.ts`

**Interfaces:**

- Consumes: `PrismaService`, `QuotaService`, `StorageService`, `AuditService`, `RedisService`.
- Produces:

```ts
class UploadExpirationService {
  expireDueSessions(now?: Date): Promise<{ expiredCount: number }>;
  acquireMergeLock(uploadSessionId: string): Promise<string>;
  releaseMergeLock(uploadSessionId: string, lockValue: string): Promise<void>;
}
```

- [ ] **Step 1: Write failing expiry test**

Create `server/test/upload/upload-expiration.service.spec.ts`:

```ts
import { UploadExpirationService } from '../../src/upload/upload-expiration.service';

const prisma: any = {
  uploadSession: { findMany: jest.fn(), update: jest.fn() },
};
const quota = { release: jest.fn() };
const storage = { abortMultipart: jest.fn() };
const audit = { record: jest.fn() };
const redis = { acquireLock: jest.fn(), releaseLock: jest.fn() };

describe('UploadExpirationService', () => {
  it('expires due sessions and releases quota', async () => {
    prisma.uploadSession.findMany.mockResolvedValue([
      {
        id: 's1',
        workspaceId: 'w1',
        mode: 'multipart',
        status: 'uploading',
        providerUploadId: 'mp-1',
        storageKey: 'key',
        quotaReserved: BigInt(10),
      },
    ]);

    const service = new UploadExpirationService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      redis as any,
    );
    const result = await service.expireDueSessions(new Date('2026-01-01T00:00:00Z'));

    expect(result).toEqual({ expiredCount: 1 });
    expect(storage.abortMultipart).toHaveBeenCalledWith({ key: 'key', uploadId: 'mp-1' });
    expect(quota.release).toHaveBeenCalledWith({
      workspaceId: 'w1',
      uploadSessionId: 's1',
      size: BigInt(10),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload.expired',
        resourceId: 's1',
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/upload/upload-expiration.service.spec.ts
```

Expected: FAIL because `UploadExpirationService` does not exist.

- [ ] **Step 3: Add Redis lock helpers**

Extend `server/src/redis/redis.service.ts`:

```ts
async acquireLock(key: string, value: string, ttlSeconds: number): Promise<boolean> {
  const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

async releaseLockIfValue(key: string, value: string): Promise<void> {
  const current = await this.client.get(key);
  if (current === value) {
    await this.client.del(key);
  }
}
```

- [ ] **Step 4: Implement expiration service**

Create `server/src/upload/upload-expiration.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class UploadExpirationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly redisService: RedisService,
  ) {}

  async expireDueSessions(now = new Date()) {
    const sessions = await this.prisma.uploadSession.findMany({
      where: {
        status: { in: ['pending', 'uploading', 'merging'] },
        expiresAt: { lt: now },
      },
      take: 200,
    });

    let expiredCount = 0;

    for (const session of sessions) {
      try {
        if (session.mode === 'multipart' && session.providerUploadId) {
          await this.storageService.abortMultipart({
            key: session.storageKey,
            uploadId: session.providerUploadId,
          });
        }

        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: { status: 'expired', failureReason: 'session_expired' },
        });

        if (session.quotaReserved > BigInt(0)) {
          await this.quotaService.release({
            workspaceId: session.workspaceId,
            uploadSessionId: session.id,
            size: session.quotaReserved,
          });
        }

        await this.auditService.record({
          workspaceId: session.workspaceId,
          actorId: session.createdBy,
          action: 'upload.expired',
          resourceType: 'upload',
          resourceId: session.id,
          after: { size: Number(session.size) },
        });

        expiredCount += 1;
      } catch (error) {
        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: { failureReason: `expiry_failed:${(error as Error).message}`.slice(0, 1000) },
        });
      }
    }

    return { expiredCount };
  }

  async acquireMergeLock(uploadSessionId: string) {
    const value = randomUUID();
    const acquired = await this.redisService.acquireLock(
      `upload:merge:${uploadSessionId}`,
      value,
      120,
    );
    if (!acquired) throw new Error('UPLOAD_MERGE_LOCK_BUSY');
    return value;
  }

  async releaseMergeLock(uploadSessionId: string, value: string) {
    await this.redisService.releaseLockIfValue(`upload:merge:${uploadSessionId}`, value);
  }
}
```

- [ ] **Step 5: Wrap merge completion with lock**

Add `UploadExpirationService` and `QueueService` as final optional constructor dependencies so existing tests remain compile-compatible:

```ts
constructor(
  private readonly prisma: PrismaService,
  private readonly quotaService: QuotaService,
  private readonly storageService: StorageService,
  private readonly auditService: AuditService,
  private readonly workspacesService: WorkspacesService,
  private readonly queueService?: QueueService,
  private readonly expirationService?: UploadExpirationService,
) {}
```

In `UploadService.complete`, immediately after the `merging` status update:

```ts
let mergeLockValue: string | null = null;

try {
  if (this.expirationService) {
    mergeLockValue = await this.expirationService.acquireMergeLock(session.id);
  }

  // existing storage completion, database, quota, and audit logic
} finally {
  if (this.expirationService && mergeLockValue) {
    await this.expirationService.releaseMergeLock(session.id, mergeLockValue);
  }
}
```

Nest production DI must provide both services; optional constructor properties only prevent older unit tests from breaking before those tests are updated.

- [ ] **Step 6: Register a 5-minute cleanup loop**

Create `server/src/upload/cron/register-upload-cron.ts`:

```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { UploadExpirationService } from '../upload-expiration.service';

@Injectable()
export class UploadCronService implements OnModuleInit {
  private timer?: NodeJS.Timeout;

  constructor(private readonly expirationService: UploadExpirationService) {}

  onModuleInit() {
    this.timer = setInterval(
      () => {
        this.expirationService.expireDueSessions().catch((error) => {
          console.error('Upload expiry job failed', error);
        });
      },
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
```

Register `UploadExpirationService` and `UploadCronService` in `UploadModule`.

- [ ] **Step 7: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/upload/upload-expiration.service.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/upload server/src/redis server/test/upload
git commit -m "feat(upload): expire sessions and lock merge completion"
```

---

### Task 7: BullMQ Thumbnail Pipeline

**Files:**

- Create: `server/src/queue/queue.module.ts`
- Create: `server/src/queue/queue.service.ts`
- Create: `server/src/queue/processors/thumbnail.processor.ts`
- Create: `server/src/thumbnails/thumbnails.service.ts`
- Modify: `server/src/upload/upload.service.ts`
- Modify: `docker-compose.dev.yml`
- Test: `server/test/upload/thumbnail-enqueue.spec.ts`

**Interfaces:**

- Consumes: upload completion, `StorageService`, Prisma.
- Produces:

```ts
class QueueService {
  addThumbnailJob(input: {
    fileVersionId: string;
    storageKey: string;
    mimeType: string;
    workspaceId: string;
  }): Promise<void>;
}
```

- [ ] **Step 1: Install backend queue dependencies**

Run from `server/`:

```bash
npm install bullmq ioredis sharp pdf-dist
```

If `pdf-dist` installation is blocked, use `pdfjs-dist@4` instead and keep the API isolated inside `ThumbnailsService`.

- [ ] **Step 2: Add worker service to development Compose**

Append to `docker-compose.dev.yml`:

```yaml
server-worker:
  image: node:20-alpine
  working_dir: /app
  command: sh -c "npm install && npm run start:worker"
  environment:
    NODE_ENV: development
    REDIS_HOST: redis
    REDIS_PORT: '6379'
    DATABASE_URL: postgresql://csp_user:csp_password_2024@postgres:5432/cloud_storage?schema=public
    STORAGE_DRIVER: minio
    MINIO_ENDPOINT: http://minio:9000
    MINIO_ACCESS_KEY: minioadmin
    MINIO_SECRET_KEY: minioadmin
    MINIO_BUCKET: clouddrive-local
  volumes:
    - ./server:/app
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    minio:
      condition: service_healthy
  networks:
    - csp-dev-network
```

Add script to `server/package.json`:

```json
{
  "start:worker": "ts-node -r tsconfig-paths/register src/worker.ts"
}
```

Create `server/src/worker.ts`:

```ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { QueueModule } from './queue/queue.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(QueueModule);
  app.enableShutdownHooks();
}

bootstrap();
```

- [ ] **Step 3: Implement queue service**

Create `server/src/queue/queue.service.ts`:

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export interface ThumbnailJobData {
  fileVersionId: string;
  storageKey: string;
  mimeType: string;
  workspaceId: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6380),
    maxRetriesPerRequest: null,
  });

  private readonly thumbnailQueue = new Queue<ThumbnailJobData>('file-thumbnail', {
    connection: this.connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

  async addThumbnailJob(input: ThumbnailJobData) {
    await this.thumbnailQueue.add('generate', input, {
      jobId: `thumbnail:${input.fileVersionId}`,
    });
  }

  async onModuleDestroy() {
    await this.thumbnailQueue.close();
    this.connection.disconnect();
  }
}
```

- [ ] **Step 4: Implement thumbnail service and processor**

Create `server/src/thumbnails/thumbnails.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class ThumbnailsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
  ) {}

  async process(input: {
    fileVersionId: string;
    storageKey: string;
    mimeType: string;
    workspaceId: string;
  }) {
    await this.prisma.fileVersion.update({
      where: { id: input.fileVersionId },
      data: { thumbnailStatus: 'processing' },
    });

    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(input.mimeType)) {
      await this.prisma.fileVersion.update({
        where: { id: input.fileVersionId },
        data: { thumbnailStatus: 'none' },
      });
      return { status: 'none' as const };
    }

    const object = await this.storageService.getObjectForProcessing(input.storageKey);
    const thumbnailKey = `thumbnails/${input.workspaceId}/${input.fileVersionId}.webp`;
    const output = await sharp(object)
      .resize(512, 512, { fit: 'inside' })
      .webp({ quality: 78 })
      .toBuffer();

    await this.storageService.putProcessedObject(thumbnailKey, output, 'image/webp');
    await this.prisma.fileVersion.update({
      where: { id: input.fileVersionId },
      data: { thumbnailKey, thumbnailStatus: 'done' },
    });

    return { status: 'done' as const, thumbnailKey };
  }
}
```

Add these two methods to `StorageDriver` and both drivers:

```ts
getObjectForProcessing(key: string): Promise<Buffer>;
putProcessedObject(key: string, body: Buffer, contentType: string): Promise<void>;
```

For MinIO/Qiniu, implement with `GetObjectCommand` and `PutObjectCommand`; convert the S3 stream to Buffer before returning.

Create `server/src/queue/processors/thumbnail.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ThumbnailsService } from '../../thumbnails/thumbnails.service';
import { ThumbnailJobData } from '../queue.service';

@Processor('file-thumbnail')
export class ThumbnailProcessor extends WorkerHost {
  constructor(private readonly thumbnailsService: ThumbnailsService) {
    super();
  }

  async process(job: Job<ThumbnailJobData>) {
    await this.thumbnailsService.process(job.data);
    return { ok: true };
  }
}
```

Create `server/src/queue/queue.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { ThumbnailProcessor } from './processors/thumbnail.processor';
import { ThumbnailsService } from '../thumbnails/thumbnails.service';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6380),
      },
    }),
    BullModule.registerQueue({ name: 'file-thumbnail' }),
    PrismaModule,
    StorageModule,
  ],
  providers: [QueueService, ThumbnailProcessor, ThumbnailsService],
  exports: [QueueService],
})
export class QueueModule {}
```

Install `@nestjs/bullmq` from `server/`:

```bash
npm install @nestjs/bullmq
```

- [ ] **Step 5: Enqueue after completion**

Inject `QueueService` into `UploadService`. At the end of successful `complete` and `confirmInstant`, call:

```ts
await this.queueService.addThumbnailJob({
  fileVersionId: created.version.id,
  storageKey: session.storageKey,
  mimeType: session.mimeType,
  workspaceId: session.workspaceId,
});
```

Wrap in `try/catch`; on enqueue failure set `file_versions.thumbnail_status = 'failed'` but do not fail the upload response.

- [ ] **Step 6: Write enqueue test**

Create `server/test/upload/thumbnail-enqueue.spec.ts`:

```ts
import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  uploadChunk: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  storageObject: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  file: { create: jest.fn(), update: jest.fn() },
  fileVersion: { create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((fn) =>
    fn({
      uploadSession: prisma.uploadSession,
      uploadChunk: prisma.uploadChunk,
      storageObject: prisma.storageObject,
      file: prisma.file,
      fileVersion: prisma.fileVersion,
    }),
  ),
};
const quota = { confirm: jest.fn(), release: jest.fn() };
const storage = { headObject: jest.fn(), completeMultipart: jest.fn(), abortMultipart: jest.fn() };
const audit = { record: jest.fn() };
const workspaces = { requireMembership: jest.fn() };
const queue = { addThumbnailJob: jest.fn().mockResolvedValue(undefined) };

describe('UploadService thumbnail enqueue', () => {
  it('enqueues a thumbnail after successful direct completion', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 'session-1',
      workspaceId: 'w1',
      createdBy: 'u1',
      mode: 'direct',
      strategy: 'normal',
      status: 'uploading',
      size: BigInt(8),
      hash: 'a'.repeat(64),
      hashAlgorithm: 'sha256',
      storageKey: 'key',
      folderId: null,
      filename: 'a.png',
      mimeType: 'image/png',
      quotaReserved: BigInt(8),
      chunks: [],
      file: null,
    });
    storage.headObject.mockResolvedValue({ key: 'key', size: 8 });
    prisma.file.create.mockResolvedValue({ id: 'file-1', urlKey: 'public-key' });
    prisma.fileVersion.create.mockResolvedValue({ id: 'version-1', fileId: 'file-1' });

    const service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
      queue as any,
    );

    await service.complete(
      { userId: 'u1', workspaceId: 'w1', memberId: 'm1', role: 'EDITOR' },
      'session-1',
      {},
    );

    expect(queue.addThumbnailJob).toHaveBeenCalledWith({
      fileVersionId: 'version-1',
      storageKey: 'key',
      mimeType: 'image/png',
      workspaceId: 'w1',
    });
  });
});
```

Use the constructor order established in Task 6: `queueService` is optional, followed by `expirationService`; both are omitted in earlier five-dependency tests.

- [ ] **Step 7: Run tests**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/upload/thumbnail-enqueue.spec.ts
npm run typecheck
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src server/test server/package.json server/package-lock.json docker-compose.dev.yml
git commit -m "feat(upload): generate thumbnails through bullmq"
```

---

### Task 8: Frontend Upload Queue Store and Hash Worker

**Files:**

- Create: `client/src/features/upload/types.ts`
- Create: `client/src/features/upload/store.ts`
- Create: `client/src/features/upload/hash.ts`
- Create: `client/public/workers/sha256-worker.js`
- Modify: `client/package.json`

**Interfaces:**

- Consumes: workspace store and permission matrix.
- Produces:

```ts
useUploadQueue(): {
  items: UploadItem[];
  enqueueFiles(files: FileList | File[], workspaceId: string, folderId?: string): void;
  retry(id: string): void;
  cancel(id: string): void;
  clearCompleted(): void;
}
```

- [ ] **Step 1: Add upload types**

Create `client/src/features/upload/types.ts`:

```ts
export type UploadItemStatus =
  | 'hashing'
  | 'creating'
  | 'instant'
  | 'uploading'
  | 'merging'
  | 'completed'
  | 'canceled'
  | 'failed';

export interface UploadItem {
  id: string;
  file: File;
  relativePath?: string;
  workspaceId: string;
  folderId?: string;
  status: UploadItemStatus;
  progress: number;
  uploadedBytes: number;
  hash?: string;
  uploadSessionId?: string;
  missingChunks?: number[];
  error?: string;
  attempt: number;
}
```

- [ ] **Step 2: Add Zustand upload reducer**

Create `client/src/features/upload/store.ts`:

```ts
import { create } from 'zustand';
import { UploadItem, UploadItemStatus } from './types';

interface UploadState {
  items: UploadItem[];
  activeCount: number;
  maxActiveFiles: number;
  setStatus: (id: string, status: UploadItemStatus, patch?: Partial<UploadItem>) => void;
  updateProgress: (id: string, uploadedBytes: number, totalBytes: number) => void;
  enqueueFiles: (files: File[], workspaceId: string, folderId?: string) => void;
  removeItem: (id: string) => void;
  clearCompleted: () => void;
}

function toItem(file: File, workspaceId: string, folderId?: string): UploadItem {
  return {
    id: crypto.randomUUID(),
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
    workspaceId,
    folderId,
    status: 'hashing',
    progress: 0,
    uploadedBytes: 0,
    attempt: 0,
  };
}

export const useUploadQueue = create<UploadState>((set, get) => ({
  items: [],
  activeCount: 0,
  maxActiveFiles: 3,
  setStatus: (id, status, patch = {}) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, status, ...patch } : item)),
    })),
  updateProgress: (id, uploadedBytes, totalBytes) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              uploadedBytes,
              progress: Math.min(99, Math.round((uploadedBytes / Math.max(totalBytes, 1)) * 100)),
            }
          : item,
      ),
    })),
  enqueueFiles: (files, workspaceId, folderId) =>
    set((state) => ({
      items: [
        ...state.items,
        ...Array.from(files).map((file) => toItem(file, workspaceId, folderId)),
      ],
    })),
  removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clearCompleted: () =>
    set((state) => ({
      items: state.items.filter((item) => !['completed', 'canceled'].includes(item.status)),
    })),
}));
```

- [ ] **Step 3: Add SHA-256 Web Worker**

Create `client/public/workers/sha256-worker.js`:

```js
async function digest(file) {
  const hasher = new crypto.subtle() ? crypto.subtle : globalThis.crypto.subtle;
  const digestValue = await hasher.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digestValue))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

self.onmessage = async (event) => {
  try {
    const hash = await digest(event.data.file);
    self.postMessage({ ok: true, id: event.data.id, hash });
  } catch (error) {
    self.postMessage({ ok: false, id: event.data.id, error: error.message });
  }
};
```

Create `client/src/features/upload/hash.ts`:

```ts
export function hashFileInWorker(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/workers/sha256-worker.js');
    const id = crypto.randomUUID();

    worker.onmessage = (event) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.ok) resolve(event.data.hash);
      else reject(new Error(event.data.error));
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(error);
    };

    worker.postMessage({ id, file });
  });
}
```

- [ ] **Step 4: Install frontend upload dependencies**

Run from `client/`:

```bash
npm install @tanstack/react-virtual react-dropzone
```

- [ ] **Step 5: Verify type compilation**

Run from `client/`:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src client/public client/package.json client/package-lock.json
git commit -m "feat(upload): add queue state and web worker hashing"
```

---

### Task 9: Upload API Client, Queue Runner, Drag-and-Drop, and Progress UI

**Files:**

- Create: `client/src/features/upload/api.ts`
- Create: `client/src/features/upload/runner.ts`
- Create: `client/src/features/upload/UploadQueuePanel.tsx`
- Create: `client/src/features/upload/UploadDropzone.tsx`
- Modify: `client/src/app/(dashboard)/files/page.tsx`

**Interfaces:**

- Consumes: upload REST API and Zustand queue.
- Produces: reusable `UploadDropzone` and visible `UploadQueuePanel`.

- [ ] **Step 1: Add API client**

Create `client/src/features/upload/api.ts`:

```ts
import api from '@/lib/api';
import { UploadItem } from './types';

export async function createUploadSession(item: UploadItem) {
  const response = await api.post(`/workspaces/${item.workspaceId}/upload/sessions`, {
    filename: item.file.name,
    mimeType: item.file.type || 'application/octet-stream',
    size: item.file.size,
    hash: item.hash,
    hashAlgorithm: 'sha256',
    folderId: item.folderId,
    clientUploadId: item.id,
  });
  return response.data;
}

export async function createDirectUrl(workspaceId: string, uploadSessionId: string) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/direct-url`,
  );
  return response.data;
}

export async function createChunkUrls(
  workspaceId: string,
  uploadSessionId: string,
  chunkIndexes: number[],
) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/chunk-urls`,
    { chunkIndexes },
  );
  return response.data;
}

export async function confirmChunk(
  workspaceId: string,
  uploadSessionId: string,
  chunkIndex: number,
  etag: string,
) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/chunks/${chunkIndex}/complete`,
    { etag },
  );
  return response.data;
}

export async function completeUpload(
  workspaceId: string,
  uploadSessionId: string,
  payload: { hash?: string; parts?: { partNumber: number; etag: string }[] } = {},
) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/complete`,
    payload,
  );
  return response.data;
}

export async function confirmInstantUpload(workspaceId: string, uploadSessionId: string) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/instant`,
  );
  return response.data;
}

export async function resumeUpload(workspaceId: string, uploadSessionId: string) {
  const response = await api.get(`/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}`);
  return response.data;
}
```

- [ ] **Step 2: Implement queue runner**

Create `client/src/features/upload/runner.ts`:

```ts
import { XHRUploadResult, putWithProgress } from './xhr';
import {
  completeUpload,
  confirmChunk,
  confirmInstantUpload,
  createChunkUrls,
  createDirectUrl,
  createUploadSession,
  resumeUpload,
} from './api';
import { hashFileInWorker } from './hash';
import { useUploadQueue } from './store';

const CHUNK_SIZE = 8 * 1024 * 1024;
const DIRECT_THRESHOLD = 8 * 1024 * 1024;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runUploadItem(id: string) {
  const state = useUploadQueue.getState();
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;

  const { setStatus, updateProgress } = useUploadQueue.getState();

  try {
    if (!item.hash) {
      setStatus(id, 'hashing');
      const hash = await hashFileInWorker(item.file);
      state.setStatus(id, 'creating', { hash });
    }

    const current = useUploadQueue.getState().items.find((entry) => entry.id === id);
    if (!current) return;

    setStatus(id, 'creating');
    const session = await createUploadSession({ ...current });
    state.setStatus(id, session.strategy === 'instant' ? 'instant' : 'uploading', {
      uploadSessionId: session.uploadSessionId,
      missingChunks: session.missingChunks,
    });

    if (session.strategy === 'instant') {
      const result = await confirmInstantUpload(item.workspaceId, session.uploadSessionId);
      setStatus(id, 'completed', {
        progress: 100,
        uploadedBytes: item.file.size,
        error: undefined,
      });
      return result;
    }

    if (item.file.size <= DIRECT_THRESHOLD) {
      const direct = await createDirectUrl(item.workspaceId, session.uploadSessionId);
      await putWithProgress(direct.uploadUrl, item.file, (bytes) =>
        updateProgress(id, bytes, item.file.size),
      );
      return await completeUpload(item.workspaceId, session.uploadSessionId, {
        hash: current.hash,
      });
    }

    const totalChunks = Math.ceil(item.file.size / CHUNK_SIZE);
    const parts: { partNumber: number; etag: string }[] = [];
    const missing = session.missingChunks?.length
      ? session.missingChunks
      : Array.from({ length: totalChunks }, (_, index) => index + 1);

    for (const chunkIndex of missing) {
      const urls = await createChunkUrls(item.workspaceId, session.uploadSessionId, [chunkIndex]);
      const start = (chunkIndex - 1) * CHUNK_SIZE;
      const blob = item.file.slice(start, Math.min(start + CHUNK_SIZE, item.file.size));

      for (let attempt = 0; attempt <= 3; attempt += 1) {
        try {
          const result: XHRUploadResult = await putWithProgress(urls[0].uploadUrl, blob, (bytes) =>
            updateProgress(id, start + bytes, item.file.size),
          );
          await confirmChunk(item.workspaceId, session.uploadSessionId, chunkIndex, result.etag);
          parts.push({ partNumber: chunkIndex, etag: result.etag });
          break;
        } catch (error) {
          if (attempt === 3) throw error;
          await sleep(1000 * 2 ** attempt);
        }
      }
    }

    setStatus(id, 'merging');
    return await completeUpload(item.workspaceId, session.uploadSessionId, {
      hash: current.hash,
      parts,
    });
  } catch (error) {
    setStatus(id, 'failed', {
      error: (error as Error).message,
      attempt: item.attempt + 1,
    });
    throw error;
  }
}

export async function resumeQueuedUploads() {
  const state = useUploadQueue.getState();
  const resumable = state.items.filter(
    (item) =>
      ['hashing', 'creating', 'uploading', 'merging', 'failed'].includes(item.status) &&
      item.uploadSessionId,
  );

  for (const item of resumable) {
    await resumeUpload(item.workspaceId, item.uploadSessionId as string);
    await runUploadItem(item.id);
  }
}
```

Create `client/src/features/upload/xhr.ts`:

```ts
export interface XHRUploadResult {
  etag: string;
}

export function putWithProgress(
  url: string,
  body: Blob,
  onProgress?: (uploadedBytes: number) => void,
): Promise<XHRUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', body.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ etag: xhr.getResponseHeader('ETag')?.replace(/"/g, '') || '' });
      } else {
        reject(new Error(`upload failed with HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(body);
  });
}
```

- [ ] **Step 3: Add drag-and-drop and queue UI**

Create `client/src/features/upload/UploadDropzone.tsx`:

```tsx
'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useWorkspaceStore } from '../workspace/store';
import { useUploadQueue } from './store';
import { runUploadItem } from './runner';

export function UploadDropzone({ folderId }: { folderId?: string }) {
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId);
  const enqueueFiles = useUploadQueue((state) => state.enqueueFiles);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!workspaceId) return;
      enqueueFiles(acceptedFiles, workspaceId, folderId);

      const items = useUploadQueue.getState().items.slice(-acceptedFiles.length);
      await Promise.all(items.map((item) => runUploadItem(item.id)));
    },
    [enqueueFiles, folderId, workspaceId],
  );

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    onDragEnter: () => setDragging(true),
    onDragLeave: () => setDragging(false),
    onDropAccepted: () => setDragging(false),
    noClick: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
        dragging
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
          : 'border-neutral-300 dark:border-neutral-700'
      }`}
    >
      <input {...getInputProps()} />
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Drop files or folders here to upload
      </p>
    </div>
  );
}
```

Create `client/src/features/upload/UploadQueuePanel.tsx`:

```tsx
'use client';

import { useUploadQueue } from './store';
import { runUploadItem } from './runner';

const STATUS_LABEL: Record<string, string> = {
  hashing: 'Calculating hash',
  creating: 'Creating session',
  instant: 'Instant upload',
  uploading: 'Uploading',
  merging: 'Merging',
  completed: 'Completed',
  canceled: 'Canceled',
  failed: 'Failed',
};

export function UploadQueuePanel() {
  const { items, retryId, cancel, clearCompleted } = useUploadQueue();

  return (
    <section className="rounded-xl border p-4 dark:border-neutral-700">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Upload queue</h2>
        <button
          onClick={clearCompleted}
          className="text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-100"
        >
          Clear completed
        </button>
      </div>

      {items.length === 0 && <p className="text-sm text-neutral-500">No active uploads.</p>}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border p-3 dark:border-neutral-700">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.file.name}</p>
                <p className="text-xs text-neutral-500">
                  {STATUS_LABEL[item.status]} · {item.progress}%
                </p>
              </div>
              <div className="flex gap-2">
                {item.status === 'failed' && (
                  <button className="text-xs text-blue-600" onClick={() => retryId(item.id)}>
                    Retry
                  </button>
                )}
                <button className="text-xs text-red-600" onClick={() => cancel(item.id)}>
                  Cancel
                </button>
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${item.progress}%` }}
              />
            </div>
            {item.error && <p className="mt-1 text-xs text-red-500">{item.error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

Add missing Zustand selectors to `useUploadQueue`:

```ts
retryId: async (id: string) => {
  const item = get().items.find(entry => entry.id === id);
  if (!item) return;
  set(state => ({
    items: state.items.map(entry => entry.id === id
      ? { ...entry, status: 'creating', error: undefined }
      : entry),
  }));
  await runUploadItem(id);
},
cancel: id => set(state => ({
  items: state.items.map(item => item.id === id
    ? { ...item, status: 'canceled' }
    : item),
})),
```

- [ ] **Step 4: Wire files page**

Modify `client/src/app/(dashboard)/files/page.tsx`:

- render `UploadDropzone` only when `UI_PERMISSIONS[role].upload` is true;
- render `UploadQueuePanel`;
- invalidate the files query when an item reaches `completed`;
- use `@tanstack/react-virtual` for lists greater than 50 rows.

- [ ] **Step 5: Verify upload flows manually**

Start dependencies and both apps, then verify:

1. A 1 KB file direct-uploads.
2. An 8 MB boundary file direct-uploads.
3. A 50 MB file multipart-uploads with 7 chunks.
4. Reloading during multipart upload and clicking retry resumes missing chunks.
5. Re-uploading identical bytes shows `Instant upload`.
6. Disconnecting the network makes a chunk fail, reconnecting allows retry.
7. Cancelling removes the queue item and releases quota.

- [ ] **Step 6: Run frontend checks**

Run from `client/`:

```bash
npm run lint
npm run build
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src
git commit -m "feat(upload): add queue ui drag drop and retry"
```

---

### Task 10: Permission UI and Frontend Upload Regression

**Files:**

- Modify: `client/src/features/upload/UploadDropzone.tsx`
- Modify: `client/src/app/(dashboard)/files/page.tsx`
- Test: `client/src/features/upload/queue.test.ts`

**Interfaces:**

- Consumes: workspace permissions, upload runner, and Zustand queue.
- Produces: permission-gated upload UI and repeatable frontend queue regression.

- [ ] **Step 1: Add frontend queue unit test**

Create `client/src/features/upload/queue.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { useUploadQueue } from './store';

describe('upload queue store', () => {
  beforeEach(() => {
    useUploadQueue.setState({ items: [] });
  });

  it('enqueues files with workspace context', () => {
    useUploadQueue
      .getState()
      .enqueueFiles([new File(['a'], 'a.txt', { type: 'text/plain' })], 'workspace-1');

    const item = useUploadQueue.getState().items[0];
    expect(item.workspaceId).toBe('workspace-1');
    expect(item.status).toBe('hashing');
  });

  it('clears only completed and canceled items', () => {
    useUploadQueue.setState({
      items: [
        {
          id: '1',
          file: new File(['a'], 'a'),
          workspaceId: 'w',
          status: 'completed',
          progress: 100,
          uploadedBytes: 1,
          attempt: 0,
        },
        {
          id: '2',
          file: new File(['a'], 'a'),
          workspaceId: 'w',
          status: 'failed',
          progress: 10,
          uploadedBytes: 1,
          attempt: 1,
        },
      ],
    });

    useUploadQueue.getState().clearCompleted();
    expect(useUploadQueue.getState().items.map((item) => item.id)).toEqual(['2']);
  });
});
```

Add Vitest from `client/`:

```bash
npm install -D vitest @vitest/coverage-v8
```

Add scripts:

```json
{
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 2: Gate upload UI by permission and add optimistic deletion**

In the files page:

- read the active workspace role;
- use `UI_PERMISSIONS[role].upload`;
- when false, render a disabled dropzone with text `You do not have permission to upload`;
- hide retry and cancel controls for viewers and guests;
- keep the queue panel visible for completed uploads so users retain feedback.

Add optimistic file deletion so successful uploads and deletion feel immediate:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

interface FileListResponse {
  items: { id: string }[];
  total: number;
}

export function useDeleteWorkspaceFile(workspaceId: string) {
  const client = useQueryClient();
  const queryKey = ['workspaces', workspaceId, 'files'];

  return useMutation({
    mutationFn: async (fileId: string) => {
      await api.delete(`/workspaces/${workspaceId}/files/${fileId}`);
    },
    onMutate: async (fileId: string) => {
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<FileListResponse>(queryKey);

      if (previous) {
        client.setQueryData<FileListResponse>(queryKey, {
          ...previous,
          items: previous.items.filter((file) => file.id !== fileId),
          total: Math.max(0, previous.total - 1),
        });
      }

      return { previous };
    },
    onError: (_error, _fileId, context) => {
      if (context?.previous) client.setQueryData(queryKey, context.previous);
    },
    onSettled: () => client.invalidateQueries({ queryKey }),
  });
}
```

When an upload queue item reaches `completed`, invalidate:

```ts
client.invalidateQueries({ queryKey: ['workspaces', workspaceId, 'files'] });
```

- [ ] **Step 3: Run frontend tests**

Run from `client/`:

```bash
npm test
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src client/package.json client/package-lock.json
git commit -m "test(upload): gate upload ui and cover queue state"
```

---

### Task 11: Folder Destination Backend and Frontend Folder Upload

**Files:**

- Create: `server/src/files/folder.service.ts`
- Create: `server/src/files/dto/ensure-folder.dto.ts`
- Create: `client/src/features/folder/api.ts`
- Modify: `server/src/files/files.controller.ts`
- Modify: `server/src/files/files.module.ts`
- Modify: `client/src/features/upload/UploadDropzone.tsx`
- Test: `server/test/files/folder.service.spec.ts`

**Interfaces:**

- Consumes: `WorkspaceGuard`, `PermissionGuard`, Prisma Folder model.
- Produces:

```ts
class FolderService {
  ensureFolderPath(
    actor: WorkspaceActorContext,
    segments: string[],
  ): Promise<{ folderId?: string }>;
}
```

- [ ] **Step 1: Write failing nested folder test**

Create `server/test/files/folder.service.spec.ts`:

```ts
import { FolderService } from '../../src/files/folder.service';

const prisma: any = {
  folder: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn(prisma)),
};

describe('FolderService.ensureFolderPath', () => {
  it('reuses an existing path and creates only missing folders', async () => {
    prisma.folder.findFirst
      .mockResolvedValueOnce({ id: 'root', path: 'docs', name: 'docs', parentId: null })
      .mockResolvedValueOnce(null);
    prisma.folder.create.mockResolvedValue({
      id: 'child',
      path: 'docs/design',
      name: 'design',
      parentId: 'root',
    });

    const service = new FolderService(prisma as any);
    const result = await service.ensureFolderPath(
      { userId: 'u', workspaceId: 'w', memberId: 'm', role: 'EDITOR' },
      ['docs', 'design'],
    );

    expect(result).toEqual({ folderId: 'child' });
    expect(prisma.folder.create).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/files/folder.service.spec.ts
```

Expected: FAIL because `FolderService` does not exist.

- [ ] **Step 3: Implement FolderService**

Create `server/src/files/dto/ensure-folder.dto.ts`:

```ts
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class EnsureFolderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(16)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(255, { each: true })
  segments!: string[];
}
```

Create `server/src/files/folder.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActorContext } from '../workspaces/types';

@Injectable()
export class FolderService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureFolderPath(actor: WorkspaceActorContext, segments: string[]) {
    let parentId: string | null = null;
    let path = '';
    let folderId: string | undefined;

    for (const rawName of segments) {
      const name = rawName.trim();
      if (!name) continue;
      path = path ? `${path}/${name}` : name;

      let folder = await this.prisma.folder.findFirst({
        where: { workspaceId: actor.workspaceId, parentId, name },
      });

      if (!folder) {
        folder = await this.prisma.folder.create({
          data: { workspaceId: actor.workspaceId, parentId, name, path, createdBy: actor.userId },
        });
      }

      parentId = folder.id;
      folderId = folder.id;
    }

    return { folderId };
  }
}
```

- [ ] **Step 4: Add route**

Add to `FilesController`:

```ts
@Post('folders/ensure')
@UseGuards(WorkspaceGuard, PermissionGuard)
@RequirePermission('file:upload')
ensureFolder(@WorkspaceActor() actor: WorkspaceActorContext, @Body() dto: EnsureFolderDto) {
  return this.folderService.ensureFolderPath(actor, dto.segments);
}
```

Route it under `workspaces/:workspaceId` using the same controller base path as workspace files. Register `FolderService` in `FilesModule`.

- [ ] **Step 5: Add frontend folder API**

Create `client/src/features/folder/api.ts`:

```ts
import api from '@/lib/api';

export async function ensureFolderDirectory(
  workspaceId: string,
  directory: string,
): Promise<string | undefined> {
  const segments = directory.split('/').filter(Boolean);

  if (segments.length === 0) return undefined;

  const response = await api.post(`/workspaces/${workspaceId}/folders/ensure`, {
    segments,
  });

  return response.data.folderId as string;
}
```

- [ ] **Step 6: Resolve folders during folder drag-and-drop**

Modify `UploadDropzone.onDrop` so folder files are grouped by directory:

```ts
const byDirectory = new Map<string, File[]>();

for (const file of acceptedFiles) {
  const relativePath =
    (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
  const directory = relativePath.replace(/[^/]+$/, '');
  byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), file]);
}

for (const [directory, files] of byDirectory) {
  const folderId = await ensureFolderDirectory(workspaceId as string, directory);
  enqueueFiles(files, workspaceId as string, folderId);
}

const queued = useUploadQueue.getState().items.slice(-acceptedFiles.length);
await Promise.all(queued.map((item) => runUploadItem(item.id)));
```

This avoids synthetic filename placeholders. Keep the existing file-only behavior when there is no `webkitRelativePath`.

- [ ] **Step 7: Run backend and frontend checks**

Run from `server/`:

```bash
npm test -- --runTestsByPath test/files/folder.service.spec.ts
npm run typecheck
```

Run from `client/`:

```bash
npm test
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/files server/test/files client/src/features
git commit -m "feat(upload): ensure nested folder destinations"
```

---

### Task 12: Upload Pipeline Regression, Docs, and Deployment Rehearsal

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/API.md`
- Modify: `docs/DATABASE.md`
- Modify: `README.md`
- Create: `docs/superpowers/plans/upload-pipeline-release-checklist.md`

**Interfaces:**

- Consumes: all upload backend and frontend tasks.
- Produces: release-ready documentation, regression evidence, and deployment checklist.

- [ ] **Step 1: Add integration regression test**

Create `server/test/upload/upload-pipeline.e2e-spec.ts` with six tests:

1. viewer upload returns `403 WORKSPACE_PERMISSION_DENIED`;
2. insufficient quota returns `413 WORKSPACE_QUOTA_EXCEEDED`;
3. direct upload completes;
4. multipart upload completes;
5. duplicate complete returns the same `fileId`;
6. expired session releases quota and returns `410 UPLOAD_SESSION_EXPIRED` on resume.

Use locally generated buffers: 1 KB, 8 MB, and 20 MB. Do not depend on external internet access.

- [ ] **Step 2: Run backend regression**

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

Expected: all PASS.

- [ ] **Step 3: Run frontend regression**

From `client/`:

```bash
npm test
npm run lint
npm run build
```

Expected: all PASS.

- [ ] **Step 4: Rehearse MinIO and Qiniu paths**

Set `STORAGE_DRIVER=minio` and run:

- 1 KB direct upload;
- 20 MB multipart upload;
- identical second upload instant upload;
- expired session cleanup.

Then use an isolated Qiniu test bucket and `STORAGE_DRIVER=qiniu` to repeat:

- 1 KB direct upload;
- 20 MB multipart upload;
- duplicate complete idempotency.

Do not run this against the production bucket.

- [ ] **Step 5: Update documentation**

Update:

- `README.md`: local MinIO URLs, commands, test accounts, upload matrix;
- `docs/ARCHITECTURE.md`: upload sequence, BullMQ worker, storage driver abstraction;
- `docs/API.md`: every upload endpoint, DTO, permission, progress/resume behavior, and error code;
- `docs/DATABASE.md`: upload ER diagram and state machine;
- create release checklist with backup, migration, deploy, smoke test, rollback commands, and observation metrics.

- [ ] **Step 6: Verify production Compose rehearsal locally**

Run:

```bash
docker compose -f docker-compose.prod.yml config
docker compose -f docker-compose.prod.yml up --build -d
docker compose -f docker-compose.prod.yml ps
```

Expected: config validates, all services become healthy, and upload smoke test succeeds.

- [ ] **Step 7: Commit**

```bash
git add docs server/test
git commit -m "test(upload): complete pipeline regression and release checklist"
```
