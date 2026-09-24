import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Query,
  Param,
  UseGuards,
  Req,
  ParseIntPipe,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FilesService } from './files.service';
import { FolderService } from './folder.service';
import { EnsureFolderDto } from './dto/ensure-folder.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { UploadCallbackDto } from './dto/upload-callback.dto';
import { InitMultipartDto } from './dto/init-multipart.dto';
import { CompleteMultipartDto } from './dto/complete-multipart.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post('presign')
  presignUpload(@CurrentUser('id') userId: string, @Body() dto: PresignUploadDto) {
    return this.filesService.presignUpload(userId, dto);
  }

  @Post('callback')
  uploadCallback(
    @CurrentUser('id') userId: string,
    @Body() dto: UploadCallbackDto,
    @Req() req: Request,
  ) {
    const ip = req.ip || (req.headers['x-forwarded-for'] as string) || 'unknown';
    return this.filesService.handleUploadCallback(userId, dto, ip);
  }

  @Post('upload-init')
  initMultipartUpload(@CurrentUser('id') userId: string, @Body() dto: InitMultipartDto) {
    return this.filesService.initMultipartUpload(userId, dto);
  }

  @Post('upload-part')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadPart(
    @CurrentUser('id') userId: string,
    @Query('uploadId') uploadId: string,
    @Query('partNumber', ParseIntPipe) partNumber: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('请上传文件分片');
    }

    return this.filesService.uploadPart(uploadId, partNumber, file.buffer);
  }

  @Post('upload-complete')
  async completeMultipartUpload(
    @CurrentUser('id') userId: string,
    @Body() dto: CompleteMultipartDto,
  ) {
    return this.filesService.completeMultipartUpload(userId, dto);
  }

  @Get()
  getFiles(
    @CurrentUser('id') userId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    return this.filesService.getFiles(userId, page, limit);
  }

  @Get('stats')
  getStats(@CurrentUser('id') userId: string) {
    return this.filesService.getStats(userId);
  }

  @Get(':id')
  getFile(@CurrentUser('id') userId: string, @Param('id') fileId: string) {
    return this.filesService.getFile(userId, fileId);
  }

  @Delete(':id')
  deleteFile(@CurrentUser('id') userId: string, @Param('id') fileId: string) {
    return this.filesService.deleteFile(userId, fileId);
  }
}

@Controller('workspaces/:workspaceId/folders')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class WorkspaceFoldersController {
  constructor(private readonly folderService: FolderService) {}

  @Post('ensure')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:upload')
  ensureFolder(@WorkspaceActor() actor: WorkspaceActorContext, @Body() dto: EnsureFolderDto) {
    return this.folderService.ensureFolderPath(actor, dto.segments);
  }
}
