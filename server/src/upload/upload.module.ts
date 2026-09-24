import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../queue/queue.module';
import { QuotaModule } from '../quota/quota.module';
import { StorageModule } from '../storage/storage.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { UploadController } from './upload.controller';
import { UploadExpirationService } from './upload-expiration.service';
import { UploadCronService } from './cron/register-upload-cron';
import { UploadService } from './upload.service';

@Module({
  imports: [WorkspacesModule, QueueModule, QuotaModule, StorageModule, AuditModule],
  controllers: [UploadController],
  providers: [UploadService, UploadExpirationService, UploadCronService],
  exports: [UploadService, UploadExpirationService],
})
export class UploadModule {}
