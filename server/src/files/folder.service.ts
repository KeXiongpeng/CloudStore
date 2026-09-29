import { ConflictException, Injectable } from '@nestjs/common';
import { Folder } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActorContext } from '../workspaces/types';

@Injectable()
export class FolderService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureFolderPath(actor: WorkspaceActorContext, segments: string[]) {
    let parentId: string | null = null;
    let path = '';
    let folderId: string | undefined;

    for (const rawName of segments) {
      const name = rawName.trim();
      if (!name) continue;
      path = path ? `${path}/${name}` : name;

      let folder: Folder | null = await this.prisma.folder.findFirst({
        where: { workspaceId: actor.workspaceId, parentId, name },
      });

      if (!folder) {
        try {
          folder = await this.prisma.folder.create({
            data: {
              workspaceId: actor.workspaceId,
              parentId,
              name,
              path,
              createdBy: actor.userId,
            },
          });
        } catch (error) {
          if ((error as { code?: string }).code !== 'P2002') throw error;
          folder = await this.prisma.folder.findFirst({
            where: { workspaceId: actor.workspaceId, parentId, name },
          });
          if (!folder) throw new ConflictException('FOLDER_CREATE_CONFLICT');
        }
      }

      parentId = folder.id;
      folderId = folder.id;
    }

    return { folderId };
  }
}
