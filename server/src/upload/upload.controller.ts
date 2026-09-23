import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { UploadService } from './upload.service';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';

@Controller('workspaces/:workspaceId/upload/sessions')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  create(@WorkspaceActor() actor: WorkspaceActorContext, @Body() dto: CreateUploadSessionDto) {
    return this.uploadService.createSession(actor, dto);
  }

  @Get(':uploadSessionId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  resume(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
    return this.uploadService.getResume(actor, id);
  }
}
