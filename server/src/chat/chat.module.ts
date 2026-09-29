import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { WorkspaceCoreModule } from '../workspaces/workspace-core.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmService } from './llm.service';
import { RagGraphService } from './rag/rag-graph.service';

// ChatModule 只负责问答编排；检索仍由 DocumentsModule 提供，模型调用由 LlmService 隔离。
@Module({
  imports: [HttpModule, DocumentsModule, WorkspaceCoreModule],
  controllers: [ChatController],
  providers: [ChatService, LlmService, RagGraphService],
})
export class ChatModule {}
