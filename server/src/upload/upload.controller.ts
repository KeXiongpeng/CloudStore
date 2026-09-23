import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { UploadService } from './upload.service';
import {
  ChunkUrlRequestDto,
  CompleteSessionDto,
  ConfirmChunkDto,
  CreateUploadSessionDto,
} from './dto/create-upload-session.dto';

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

  @Post(':uploadSessionId/direct-url')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  directUrl(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
    return this.uploadService.createDirectUrl(actor, id);
  }

  @Post(':uploadSessionId/instant')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  instant(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
    return this.uploadService.confirmInstant(actor, id);
  }

  @Post(':uploadSessionId/chunk-urls')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  chunkUrls(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('uploadSessionId') id: string,
    @Body() dto: ChunkUrlRequestDto,
  ) {
    return this.uploadService.createChunkUrls(actor, id, dto.chunkIndexes);
  }

  @Post(':uploadSessionId/chunks/:chunkIndex/complete')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  confirmChunk(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('uploadSessionId') id: string,
    @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
    @Body() dto: ConfirmChunkDto,
  ) {
    return this.uploadService.confirmChunk(actor, id, chunkIndex, dto.etag);
  }

  @Post(':uploadSessionId/complete')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  complete(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('uploadSessionId') id: string,
    @Body() dto: CompleteSessionDto,
  ) {
    return this.uploadService.complete(actor, id, dto);
  }

  @Delete(':uploadSessionId/cancel')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  cancel(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
    return this.uploadService.cancel(actor, id);
  }

  @Get(':uploadSessionId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('file:upload')
  resume(@WorkspaceActor() actor: WorkspaceActorContext, @Param('uploadSessionId') id: string) {
    return this.uploadService.getResume(actor, id);
  }
}
