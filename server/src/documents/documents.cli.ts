import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { DocumentsService } from './documents.service';

// D2 的命令行入口：不经过 HTTP Controller，直接调用 Service，方便学习时看清数据流。
// 用法：
//   npm run documents:ingest -- <Markdown文件路径>
//   npm run documents:search -- "查询内容" [返回条数]
async function main() {
  const [command, firstArgument, secondArgument] = process.argv.slice(2);

  if (!command) {
    console.error('用法：');
    console.error('  npm run documents:ingest -- <Markdown文件路径>');
    console.error('  npm run documents:search -- "查询内容" [返回条数]');
    process.exitCode = 1;
    return;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const documentsService = app.get(DocumentsService);

    if (command === 'ingest') {
      if (!firstArgument) {
        throw new Error('请提供 Markdown 文件路径');
      }
      const result = await documentsService.ingestFile(firstArgument);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'search') {
      if (!firstArgument) {
        throw new Error('请提供查询文本');
      }
      const limit = secondArgument ? Number.parseInt(secondArgument, 10) : 5;
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new Error('返回条数必须是正整数');
      }
      const results = await documentsService.search(firstArgument, limit);
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
