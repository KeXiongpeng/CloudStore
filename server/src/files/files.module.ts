import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { WorkspaceFilesService } from './workspace-files.service';
import { FilesController, WorkspaceFoldersController } from './files.controller';
import { FolderService } from './folder.service';
import { WorkspaceFilesController } from './workspace-files.controller';
import { WorkspaceCoreModule } from '../workspaces/workspace-core.module';
import { S3Module } from '../s3/s3.module';

@Module({
  imports: [WorkspaceCoreModule, S3Module],
  controllers: [FilesController, WorkspaceFilesController, WorkspaceFoldersController],
  providers: [FilesService, WorkspaceFilesService, FolderService],
  exports: [FilesService, FolderService],
})
export class FilesModule {}
