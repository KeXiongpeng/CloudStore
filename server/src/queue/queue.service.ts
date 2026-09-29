import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

export interface ThumbnailJobData {
  fileVersionId: string;
  storageKey: string;
  mimeType: string;
  workspaceId: string;
}

export interface DocumentIndexJobData {
  fileId: string;
  fileVersionId: string;
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

  private readonly documentIndexQueue = new Queue<DocumentIndexJobData>('document-index', {
    connection: this.connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 200,
      removeOnFail: 1000,
    },
  });

  async addThumbnailJob(input: ThumbnailJobData) {
    await this.thumbnailQueue.add('generate', input, {
      jobId: `thumbnail-${input.fileVersionId}`,
    });
  }

  async addDocumentIndexJob(input: DocumentIndexJobData) {
    const jobId = `document-index-${input.fileVersionId}`;

    // BullMQ 的固定 jobId 同时用于幂等去重和失败后挡重试。
    // 用户触发 reindex 时必须移除 failed job；active/waiting/delayed job 保持原样，避免重复消费。
    const existingJob = await this.documentIndexQueue.getJob(jobId);
    if (existingJob && (await existingJob.isFailed())) {
      await existingJob.remove();
    }

    await this.documentIndexQueue.add('index', input, { jobId });
  }

  async onModuleDestroy() {
    await Promise.all([this.thumbnailQueue.close(), this.documentIndexQueue.close()]);
    this.connection.disconnect();
  }
}
