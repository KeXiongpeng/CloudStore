// D2 验收检查：统计 document_chunks 的数量和向量维度，
// 与 D1 的 check-embeddings.js 对应，用于确认"每个 chunk 都是 1024 维向量"。
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw`
    SELECT
      count(*)::int AS count,
      min(array_length(embedding::real[], 1))::int AS min_dimensions,
      max(array_length(embedding::real[], 1))::int AS max_dimensions
    FROM document_chunks
  `;

  console.table(rows);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
