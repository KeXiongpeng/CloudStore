-- CreateEnum
CREATE TYPE "UploadMode" AS ENUM ('direct', 'multipart');

-- CreateEnum
CREATE TYPE "UploadStrategy" AS ENUM ('normal', 'instant');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('pending', 'uploading', 'merging', 'completed', 'failed', 'canceled', 'expired');

-- CreateEnum
CREATE TYPE "UploadChunkStatus" AS ENUM ('pending', 'uploaded', 'failed');

-- CreateEnum
CREATE TYPE "ThumbnailStatus" AS ENUM ('none', 'pending', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "StorageObjectStatus" AS ENUM ('available', 'pending_delete', 'deleted');

-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(1024) NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- Alter legacy files before enforcing the upload pipeline schema
ALTER TABLE "files" ADD COLUMN "updated_by" TEXT;
ALTER TABLE "files" ADD COLUMN "folder_id" TEXT;
ALTER TABLE "files" ADD COLUMN "name" VARCHAR(255);
ALTER TABLE "files" ADD COLUMN "extension" VARCHAR(32);
ALTER TABLE "files" ADD COLUMN "size" BIGINT;
ALTER TABLE "files" ADD COLUMN "hash" VARCHAR(128);
ALTER TABLE "files" ADD COLUMN "hash_algorithm" VARCHAR(16) NOT NULL DEFAULT 'sha256';
ALTER TABLE "files" ADD COLUMN "current_version_id" TEXT;
ALTER TABLE "files" ADD COLUMN "upload_session_id" TEXT;
ALTER TABLE "files" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';
ALTER TABLE "files" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "files"
SET "updated_by" = "created_by",
    "name" = "original_name",
    "size" = "file_size",
    "visibility" = CASE WHEN "is_private" THEN 'private' ELSE 'public' END
WHERE "updated_by" IS NULL OR "name" IS NULL OR "size" IS NULL;

-- CreateTable
CREATE TABLE "file_versions" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "size" BIGINT NOT NULL,
    "hash" VARCHAR(128),
    "hash_algorithm" VARCHAR(16) NOT NULL DEFAULT 'sha256',
    "mime_type" VARCHAR(255) NOT NULL,
    "metadata" JSONB,
    "thumbnail_key" VARCHAR(1024),
    "thumbnail_status" "ThumbnailStatus" NOT NULL DEFAULT 'none',
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- Preserve every legacy object as version 1
INSERT INTO "file_versions" (
  "id", "file_id", "version_no", "storage_key", "size", "hash",
  "hash_algorithm", "mime_type", "created_by", "created_at"
)
SELECT
  gen_random_uuid()::text,
  f."id",
  1,
  f."storage_key",
  f."file_size",
  f."hash",
  'sha256',
  f."mime_type",
  f."created_by",
  f."created_at"
FROM "files" f;

UPDATE "files" f
SET "current_version_id" = v."id"
FROM "file_versions" v
WHERE v."file_id" = f."id" AND v."version_no" = 1;

ALTER TABLE "files" ALTER COLUMN "updated_by" SET NOT NULL;
ALTER TABLE "files" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "files" ALTER COLUMN "size" SET NOT NULL;
ALTER TABLE "files" ALTER COLUMN "mime_type" TYPE VARCHAR(255);

-- CreateTable
CREATE TABLE "storage_objects" (
    "id" TEXT NOT NULL,
    "hash_algorithm" VARCHAR(16) NOT NULL,
    "hash" VARCHAR(128) NOT NULL,
    "size" BIGINT NOT NULL,
    "storage_driver" VARCHAR(32) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "reference_count" INTEGER NOT NULL DEFAULT 0,
    "status" "StorageObjectStatus" NOT NULL DEFAULT 'available',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "client_upload_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "folder_id" TEXT,
    "created_by" TEXT NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "size" BIGINT NOT NULL,
    "hash" VARCHAR(128),
    "hash_algorithm" VARCHAR(16) NOT NULL DEFAULT 'sha256',
    "chunk_size" INTEGER NOT NULL,
    "total_chunks" INTEGER NOT NULL,
    "uploaded_chunks" INTEGER NOT NULL DEFAULT 0,
    "mode" "UploadMode" NOT NULL,
    "strategy" "UploadStrategy" NOT NULL DEFAULT 'normal',
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'pending',
    "storage_key" VARCHAR(1024) NOT NULL,
    "provider_upload_id" VARCHAR(255),
    "quota_reserved" BIGINT NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "failure_reason" VARCHAR(1024),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_chunks" (
    "id" TEXT NOT NULL,
    "upload_session_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "size" BIGINT NOT NULL,
    "etag" VARCHAR(255),
    "status" "UploadChunkStatus" NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "uploaded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_quotas" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "total_size" BIGINT NOT NULL,
    "used_size" BIGINT NOT NULL DEFAULT 0,
    "reserved_size" BIGINT NOT NULL DEFAULT 0,
    "max_file_size" BIGINT NOT NULL,
    "max_file_count" INTEGER NOT NULL DEFAULT 100000,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_quotas_pkey" PRIMARY KEY ("id")
);

-- Seed workspace quotas from the owner's legacy user quota
INSERT INTO "workspace_quotas" (
  "id", "workspace_id", "total_size", "used_size", "reserved_size",
  "max_file_size", "max_file_count", "updated_at"
)
SELECT
  gen_random_uuid()::text,
  w."id",
  COALESCE(q."storage_limit", 10737418240),
  COALESCE(q."storage_used", 0),
  0,
  COALESCE(q."storage_limit", 10737418240),
  100000,
  CURRENT_TIMESTAMP
FROM "workspaces" w
LEFT JOIN "user_quotas" q ON q."user_id" = w."owner_id";

-- CreateIndex
CREATE UNIQUE INDEX "folders_workspace_id_parent_id_name_key" ON "folders"("workspace_id", "parent_id", "name");
CREATE INDEX "folders_workspace_id_path_idx" ON "folders"("workspace_id", "path");
CREATE INDEX "files_workspace_id_deleted_at_created_at_idx" ON "files"("workspace_id", "deleted_at", "created_at");
CREATE INDEX "files_workspace_id_folder_id_name_idx" ON "files"("workspace_id", "folder_id", "name");
CREATE UNIQUE INDEX "file_versions_file_id_version_no_key" ON "file_versions"("file_id", "version_no");
CREATE INDEX "file_versions_hash_idx" ON "file_versions"("hash");
CREATE UNIQUE INDEX "storage_objects_storage_driver_hash_algorithm_hash_key" ON "storage_objects"("storage_driver", "hash_algorithm", "hash");
CREATE INDEX "storage_objects_storage_driver_status_idx" ON "storage_objects"("storage_driver", "status");
CREATE UNIQUE INDEX "upload_sessions_client_upload_id_key" ON "upload_sessions"("client_upload_id");
CREATE INDEX "upload_sessions_workspace_id_created_by_status_idx" ON "upload_sessions"("workspace_id", "created_by", "status");
CREATE INDEX "upload_sessions_status_expires_at_idx" ON "upload_sessions"("status", "expires_at");
CREATE UNIQUE INDEX "upload_chunks_upload_session_id_chunk_index_key" ON "upload_chunks"("upload_session_id", "chunk_index");
CREATE UNIQUE INDEX "workspace_quotas_workspace_id_key" ON "workspace_quotas"("workspace_id");

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_upload_session_id_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "upload_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "files" ADD CONSTRAINT "files_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "upload_chunks" ADD CONSTRAINT "upload_chunks_upload_session_id_fkey" FOREIGN KEY ("upload_session_id") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_quotas" ADD CONSTRAINT "workspace_quotas_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Remove legacy-only file columns after migration
DROP INDEX IF EXISTS "files_storage_key_key";
ALTER TABLE "files" DROP CONSTRAINT IF EXISTS "files_user_id_fkey";
ALTER TABLE "files" DROP COLUMN "user_id";
ALTER TABLE "files" DROP COLUMN "original_name";
ALTER TABLE "files" DROP COLUMN "storage_key";
ALTER TABLE "files" DROP COLUMN "file_size";
ALTER TABLE "files" DROP COLUMN "is_private";
ALTER TABLE "files" DROP COLUMN "view_count";
ALTER TABLE "files" DROP COLUMN "download_count";
ALTER TABLE "files" DROP COLUMN "upload_ip";
