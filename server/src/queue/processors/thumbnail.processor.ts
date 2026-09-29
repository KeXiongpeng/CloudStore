import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { ThumbnailsService } from '../../thumbnails/thumbnails.service';
import { ThumbnailJobData } from '../queue.service';

@Injectable()
export class ThumbnailProcessor implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<ThumbnailJobData>;

  constructor(private readonly thumbnailsService: ThumbnailsService) {}

  onModuleInit() {
    this.worker = new Worker<ThumbnailJobData>(
      'file-thumbnail',
      async (job: Job<ThumbnailJobData>) => {
        await this.thumbnailsService.process(job.data);
        return { ok: true };
      },
      {
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: Number(process.env.REDIS_PORT || 6379),
          maxRetriesPerRequest: null,
        },
      },
    );

    this.worker.on('failed', (job, error) => {
      console.error(`Thumbnail job ${job?.id ?? 'unknown'} failed`, error);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
