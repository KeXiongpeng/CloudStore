import {
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { WorkspaceFileAccessService, WorkspaceFilesService } from './workspace-files.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { Request, Response } from 'express';

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
    @Query('page') pageInput: string | undefined = '1',
    @Query('limit') limitInput: string | undefined = '20',
  ) {
    const page = this.parsePositiveInteger(pageInput, 'page', 1);
    const limit = this.parsePositiveInteger(limitInput, 'limit', 20);
    return this.filesService.list(actor, page, limit);
  }

  private parsePositiveInteger(
    value: string | undefined,
    name: string,
    defaultValue: number,
  ): number {
    if (value === undefined || value === '') return defaultValue;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${name} must be a positive integer`);
    }
    return parsed;
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

  @Get(':fileId/content')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:view')
  content(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.fileAccessService.streamContent(
      actor,
      fileId,
      res,
      req.headers.range as string | undefined,
    );
  }

  @Post(':fileId/reindex')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:upload')
  reindex(@WorkspaceActor() actor: WorkspaceActorContext, @Param('fileId') fileId: string) {
    return this.filesService.reindex(actor, fileId);
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
