import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { DocumentIndexService } from '../../documents/document-index.service';
import { formatSafeError } from '../../common/utils/safe-error';

@Injectable()
export class DocumentIndexProcessor implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker;

  constructor(private readonly documentIndexService: DocumentIndexService) {}

  onModuleInit() {
    this.worker = new Worker(
      'document-index',
      async (job: Job<{ fileVersionId: string }>) => {
        return this.documentIndexService.processIndex(job.data.fileVersionId);
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
      // BullMQ 传入的 error 可能是 AxiosError；完整 inspect 会泄漏请求头里的 API key。
      console.error(`Document index job ${job?.id ?? 'unknown'} failed ${formatSafeError(error)}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
