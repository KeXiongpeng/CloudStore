import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { EmbeddingService } from './embedding.service';

// 这个 CLI 是 D1 的最小闭环：文本 -> API 生成向量 -> pgvector 入库 -> 余弦相似度查询。
// 它不经过 HTTP Controller，便于学习时先看清 Service 和 SQL 的核心链路。
async function main() {
  const [command, text, argument] = process.argv.slice(2);

  if (!command || !text) {
    console.error('用法：');
    console.error('  npm run embedding:ingest -- "要入库的文本"');
    console.error('  npm run embedding:search -- "要查询的文本" [返回条数]');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const embeddingService = app.get(EmbeddingService);

    if (command === 'ingest') {
      let metadata: Record<string, unknown> | undefined;
      if (argument) {
        metadata = JSON.parse(argument) as Record<string, unknown>;
      }
      const result = await embeddingService.ingestText(text, metadata);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'search') {
      const limit = argument ? Number.parseInt(argument, 10) : 5;
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error('返回条数必须是正整数');
      }
      const results = await embeddingService.searchByText(text, limit);
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    throw new Error(`未知命令：${command}，只支持 ingest 和 search`);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
