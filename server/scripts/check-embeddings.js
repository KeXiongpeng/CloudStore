const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRaw`
    SELECT
      count(*)::int AS count,
      min(array_length(embedding::real[], 1))::int AS min_dimensions,
      max(array_length(embedding::real[], 1))::int AS max_dimensions
    FROM text_embeddings
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
