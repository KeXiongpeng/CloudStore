-- pgvector 是 PostgreSQL 扩展，先安装扩展才能使用 vector 类型和距离运算符。
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "text_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "embedding" vector(1024) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "text_embeddings_pkey" PRIMARY KEY ("id")
);

-- HNSW 是近似最近邻索引：数据量变大后，它通过图结构避免全表逐行计算距离。
-- vector_cosine_ops 对应 <=>（cosine distance），必须和查询时使用的距离函数一致。
CREATE INDEX "text_embeddings_embedding_hnsw_idx"
    ON "text_embeddings" USING hnsw ("embedding" vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
