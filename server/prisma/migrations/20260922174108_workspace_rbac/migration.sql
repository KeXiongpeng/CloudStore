-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER', 'GUEST');

-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "WorkspaceMemberStatus" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "workspace_id" TEXT;

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "owner_id" TEXT NOT NULL,
    "storage_driver" VARCHAR(32) NOT NULL DEFAULT 'qiniu',
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "status" "WorkspaceMemberStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_invitations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "actor_id" TEXT,
    "action" VARCHAR(64) NOT NULL,
    "resource_type" VARCHAR(32) NOT NULL,
    "resource_id" VARCHAR(64) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "request_id" VARCHAR(64),
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces"("slug");

-- CreateIndex
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces"("owner_id");

-- CreateIndex
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_token_hash_key" ON "workspace_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "workspace_invitations_email_idx" ON "workspace_invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_invitations_workspace_id_email_status_key" ON "workspace_invitations"("workspace_id", "email", "status");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_actor_id_created_at_idx" ON "audit_logs"("workspace_id", "actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_resource_type_resource_id_idx" ON "audit_logs"("workspace_id", "resource_type", "resource_id");

-- Backfill one Personal Workspace per existing user
INSERT INTO "workspaces" ("id", "name", "slug", "owner_id", "storage_driver", "status", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  COALESCE(u."nickname", split_part(u."email", '@', 1)) || ' Workspace',
  'u-' || replace(u."id", '-', ''),
  u."id",
  'qiniu',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "users" u;

INSERT INTO "workspace_members" ("id", "workspace_id", "user_id", "role", "status", "joined_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  w."id",
  w."owner_id",
  'OWNER',
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "workspaces" w;

UPDATE "files"
SET "workspace_id" = w."id",
    "created_by" = "files"."user_id"
FROM "workspaces" w
WHERE "files"."user_id" = w."owner_id";

ALTER TABLE "files" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "files" ALTER COLUMN "created_by" SET NOT NULL;

INSERT INTO "audit_logs" ("id", "workspace_id", "actor_id", "action", "resource_type", "resource_id", "created_at")
SELECT
  gen_random_uuid()::text,
  w."id",
  w."owner_id",
  'workspace.migrated',
  'workspace',
  w."id",
  CURRENT_TIMESTAMP
FROM "workspaces" w;
-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

