import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceCoreModule } from './workspace-core.module';
import { MemberController } from './member.controller';
import { MemberService } from './member.service';
import { WorkspacesController } from './workspaces.controller';

@Module({
  imports: [WorkspaceCoreModule, AuditModule],
  controllers: [WorkspacesController, MemberController],
  providers: [MemberService],
  exports: [WorkspaceCoreModule],
})
export class WorkspacesModule {}
