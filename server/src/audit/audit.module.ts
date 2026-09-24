import { Module } from '@nestjs/common';
import { WorkspaceCoreModule } from '../workspaces/workspace-core.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [WorkspaceCoreModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
