import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActorContext } from './types';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';

@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  async requireMembership(workspaceId: string, userId: string): Promise<WorkspaceActorContext> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: true },
    });

    if (!member || member.workspace.status !== 'active') {
      throw new NotFoundException('WORKSPACE_NOT_FOUND');
    }

    if (member.status !== 'active') {
      throw new ForbiddenException('WORKSPACE_MEMBER_INACTIVE');
    }

    return {
      userId,
      workspaceId,
      memberId: member.id,
      role: member.role,
    };
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
  }

  async createWorkspace(userId: string, dto: CreateWorkspaceDto) {
    const baseSlug = this.slugify(dto.name);
    if (!baseSlug) throw new BadRequestException('VALIDATION_ERROR');

    for (let index = 0; index < 20; index += 1) {
      const slug = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
      if (await this.prisma.workspace.findUnique({ where: { slug } })) continue;

      return this.prisma.$transaction(async (tx) => {
        const workspace = await tx.workspace.create({
          data: { name: dto.name, slug, ownerId: userId, storageDriver: 'qiniu' },
        });
        await tx.workspaceMember.create({
          data: { workspaceId: workspace.id, userId, role: 'OWNER' },
        });
        return workspace;
      });
    }

    throw new ConflictException('WORKSPACE_SLUG_EXHAUSTED');
  }

  async listWorkspaces(userId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { userId, status: 'active', workspace: { status: 'active' } },
      include: { workspace: true },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async getWorkspace(actor: WorkspaceActorContext) {
    return this.prisma.workspace.findFirst({
      where: { id: actor.workspaceId, status: 'active' },
      include: { members: { where: { status: 'active' } } },
    });
  }

  async updateWorkspace(actor: WorkspaceActorContext, dto: UpdateWorkspaceDto) {
    return this.prisma.workspace.update({
      where: { id: actor.workspaceId },
      data: { name: dto.name },
    });
  }

  async deleteWorkspace(actor: WorkspaceActorContext) {
    if (actor.role !== 'OWNER') {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    await this.prisma.workspace.delete({ where: { id: actor.workspaceId } });
    return { id: actor.workspaceId };
  }
}
