import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { configuration, configValidationSchema } from '../common/config/configuration';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { LlmService } from '../chat/llm.service';
import { RagGraphService } from '../chat/rag/rag-graph.service';
import { RagAnswerJudgeService } from './rag-answer-judge.service';
import { RagEvaluationService } from './rag-evaluation.service';
import { RagReportService } from './rag-report.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '..', '.env'),
      load: [configuration],
      validationSchema: configValidationSchema,
    }),
    PrismaModule,
    StorageModule,
    HttpModule,
    DocumentsModule,
  ],
  providers: [
    LlmService,
    RagGraphService,
    RagAnswerJudgeService,
    RagEvaluationService,
    RagReportService,
  ],
  exports: [RagEvaluationService, RagReportService],
})
export class EvaluationModule {}
