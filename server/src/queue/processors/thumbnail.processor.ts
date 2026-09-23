import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ThumbnailsService } from '../../thumbnails/thumbnails.service';
import { ThumbnailJobData } from '../queue.service';

@Processor('file-thumbnail')
export class ThumbnailProcessor extends WorkerHost {
  constructor(private readonly thumbnailsService: ThumbnailsService) {
    super();
  }

  async process(job: Job<ThumbnailJobData>) {
    await this.thumbnailsService.process(job.data);
    return { ok: true };
  }
}
