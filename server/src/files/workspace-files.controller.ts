import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { WorkspaceFileAccessService, WorkspaceFilesService } from './workspace-files.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { Request } from 'express';

@Controller('workspaces/:workspaceId/files')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class WorkspaceFilesController {
  constructor(
    private readonly filesService: WorkspaceFilesService,
    private readonly fileAccessService: WorkspaceFileAccessService,
  ) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermission('file:view')
  list(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    return this.filesService.list(actor, page, limit);
  }

  @Get('stats')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:view')
  stats(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.filesService.stats(actor);
  }

  @Get(':fileId/access-url')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:view')
  accessUrl(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('fileId') fileId: string,
    @Query('mode') mode: 'preview' | 'download' = 'preview',
    @Req() req: Request,
  ) {
    return this.fileAccessService.getUrl(
      actor,
      fileId,
      mode === 'download' ? 'download' : 'preview',
      req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown',
    );
  }

  @Get(':fileId')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:view')
  get(@WorkspaceActor() actor: WorkspaceActorContext, @Param('fileId') fileId: string) {
    return this.filesService.get(actor, fileId);
  }

  @Delete(':fileId')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:delete')
  delete(@WorkspaceActor() actor: WorkspaceActorContext, @Param('fileId') fileId: string) {
    return this.filesService.delete(actor, fileId);
  }
}
