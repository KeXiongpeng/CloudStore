-- documents 保存 Markdown 源文档的元信息：
-- source_path 唯一，方便按文件路径做幂等导入；
-- content_hash 用来判断文件内容是否变化，未变化就跳过重新入库。
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "documents_source_path_key" ON "documents"("source_path");

-- document_chunks 是检索的最小单元：
-- document_id + chunk_index 唯一，保证同一文档内块顺序稳定、可溯源。
-- heading_path 存 JSONB 数组，例如 ["D2交接", "数据模型"]，检索时用来回答"这段内容在文档哪个标题下"。
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "heading_path" JSONB,
    "metadata" JSONB,
    "embedding" vector(1024) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");

-- 与 D1 相同的 HNSW 近似最近邻索引：
-- vector_cosine_ops 必须配合查询里的 <=> 运算符，索引才能生效。
CREATE INDEX "document_chunks_embedding_hnsw_idx"
    ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- 文档删除时级联删除它的所有 chunk，避免出现孤儿向量。
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
