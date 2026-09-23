import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { QuotaModule } from '../quota/quota.module';
import { StorageModule } from '../storage/storage.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

@Module({
  imports: [WorkspacesModule, QuotaModule, StorageModule, AuditModule],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
