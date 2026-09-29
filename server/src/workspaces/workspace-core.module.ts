import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceGuard } from './guards/workspace.guard';
import { PermissionGuard } from './guards/permission.guard';

@Module({
  imports: [PrismaModule],
  providers: [WorkspacesService, WorkspaceGuard, PermissionGuard],
  exports: [WorkspacesService, WorkspaceGuard, PermissionGuard],
})
export class WorkspaceCoreModule {}
