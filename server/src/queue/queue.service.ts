import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export interface ThumbnailJobData {
  fileVersionId: string;
  storageKey: string;
  mimeType: string;
  workspaceId: string;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    maxRetriesPerRequest: null,
  });

  private readonly thumbnailQueue = new Queue<ThumbnailJobData>('file-thumbnail', {
    connection: this.connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  });

  async addThumbnailJob(input: ThumbnailJobData) {
    await this.thumbnailQueue.add('generate', input, {
      jobId: `thumbnail:${input.fileVersionId}`,
    });
  }

  async onModuleDestroy() {
    await this.thumbnailQueue.close();
    this.connection.disconnect();
  }
}
