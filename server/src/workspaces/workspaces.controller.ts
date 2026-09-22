import { Body, Controller, Delete, Get, Patch, Post, Param, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
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
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly auditService: AuditService,
  ) {}

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWorkspaceDto,
    @Req() request: Request,
  ) {
    return this.workspacesService.createWorkspace(userId, dto).then((workspace) => {
      void this.auditService.record({
        workspaceId: workspace.id,
        actorId: userId,
        action: 'workspace.created',
        resourceType: 'workspace',
        resourceId: workspace.id,
        after: { name: workspace.name, slug: workspace.slug },
        ip: (request.ip || 'unknown') as string,
        userAgent: (request.headers['user-agent'] || 'unknown') as string,
        requestId: (request.headers['x-request-id'] || 'unknown') as string,
      });
      return workspace;
    });
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
  update(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Body() dto: UpdateWorkspaceDto,
    @Req() request: Request,
  ) {
    return this.workspacesService.updateWorkspace(actor, dto).then((workspace) => {
      void this.auditService.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: 'workspace.updated',
        resourceType: 'workspace',
        resourceId: workspace.id,
        after: { name: workspace.name },
        ip: (request.ip || 'unknown') as string,
        userAgent: (request.headers['user-agent'] || 'unknown') as string,
        requestId: (request.headers['x-request-id'] || 'unknown') as string,
      });
      return workspace;
    });
  }

  @Delete(':workspaceId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('workspace:delete')
  delete(@WorkspaceActor() actor: WorkspaceActorContext, @Req() request: Request) {
    return this.workspacesService.deleteWorkspace(actor).then((result) => {
      void this.auditService.record({
        actorId: actor.userId,
        action: 'workspace.deleted',
        resourceType: 'workspace',
        resourceId: actor.workspaceId,
        ip: (request.ip || 'unknown') as string,
        userAgent: (request.headers['user-agent'] || 'unknown') as string,
        requestId: (request.headers['x-request-id'] || 'unknown') as string,
      });
      return result;
    });
  }
}
