import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { configuration, configValidationSchema } from '../common/config/configuration';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ThumbnailsService } from '../thumbnails/thumbnails.service';
import { ThumbnailProcessor } from './processors/thumbnail.processor';
import { QueueService } from './queue.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
    }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
      },
    }),
    BullModule.registerQueue({ name: 'file-thumbnail' }),
    PrismaModule,
    StorageModule,
  ],
  providers: [QueueService, ThumbnailProcessor, ThumbnailsService],
  exports: [QueueService],
})
export class QueueModule {}
