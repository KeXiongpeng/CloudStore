-- Unified workspace uploads become the source of knowledge documents.
DO $$ BEGIN
  CREATE TYPE "DocumentIndexStatus" AS ENUM ('pending', 'processing', 'indexed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "documents"
  ADD COLUMN "workspace_id" TEXT,
  ADD COLUMN "file_id" TEXT,
  ADD COLUMN "file_version_id" TEXT,
  ADD COLUMN "index_status" "DocumentIndexStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN "indexed_at" TIMESTAMPTZ(3),
  ADD COLUMN "index_error" TEXT;

CREATE UNIQUE INDEX "documents_file_id_key" ON "documents"("file_id");
CREATE UNIQUE INDEX "documents_file_version_id_key" ON "documents"("file_version_id");
CREATE INDEX "documents_workspace_id_index_status_idx" ON "documents"("workspace_id", "index_status");

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_file_id_fkey"
    FOREIGN KEY ("file_id") REFERENCES "files"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_file_version_id_fkey"
    FOREIGN KEY ("file_version_id") REFERENCES "file_versions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;