import { Body, Controller, Delete, Get, Patch, Post, Param, UseGuards } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';
import { WorkspaceGuard } from './guards/workspace.guard';
import { PermissionGuard } from './guards/permission.guard';
import { RequirePermission } from './decorators/require-permission.decorator';
import { WorkspaceActor } from './decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from './types';

@Controller('workspaces')
@UseGuards(JwtAuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.createWorkspace(userId, dto);
  }

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.workspacesService.listWorkspaces(userId);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('workspace:view')
  get(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.workspacesService.getWorkspace(actor);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('workspace:update')
  update(@WorkspaceActor() actor: WorkspaceActorContext, @Body() dto: UpdateWorkspaceDto) {
    return this.workspacesService.updateWorkspace(actor, dto);
  }

  @Delete(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('workspace:delete')
  delete(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.workspacesService.deleteWorkspace(actor);
  }
}
