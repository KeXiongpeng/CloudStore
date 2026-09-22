import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';
import { WorkspaceGuard } from './guards/workspace.guard';
import { PermissionGuard } from './guards/permission.guard';

@Module({
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceGuard, PermissionGuard],
  exports: [WorkspacesService, WorkspaceGuard, PermissionGuard],
})
export class WorkspacesModule {}
