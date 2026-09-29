import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration, configValidationSchema } from '../common/config/configuration';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ThumbnailsService } from '../thumbnails/thumbnails.service';
import { DocumentIndexProcessor } from './processors/document-index.processor';
import { ThumbnailProcessor } from './processors/thumbnail.processor';
import { QueueService } from './queue.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
    }),
    DocumentsModule,
    PrismaModule,
    StorageModule,
  ],
  providers: [QueueService, ThumbnailProcessor, DocumentIndexProcessor, ThumbnailsService],
  exports: [QueueService],
})
export class QueueModule {}
