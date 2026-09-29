import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { DocumentsController } from './documents.controller';
import { DocumentIndexService } from './document-index.service';
import { TextExtractor } from './text-extractor';
import { DocumentsService } from './documents.service';

// D2 只暴露 CLI；D3 加上 Controller 后，同一套 Service 能同时服务 CLI 和 HTTP。
// DocumentIndexService 是统一上传完成后的异步索引核心。
@Module({
  imports: [EmbeddingModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentIndexService, TextExtractor],
  exports: [DocumentsService, DocumentIndexService],
})
export class DocumentsModule {}
