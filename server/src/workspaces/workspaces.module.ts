import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceCoreModule } from './workspace-core.module';
import { WorkspacesController } from './workspaces.controller';

@Module({
  imports: [WorkspaceCoreModule, AuditModule],
  controllers: [WorkspacesController],
  exports: [WorkspaceCoreModule],
})
export class WorkspacesModule {}
