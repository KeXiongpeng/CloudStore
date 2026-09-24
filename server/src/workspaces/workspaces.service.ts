import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActorContext } from './types';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/create-workspace.dto';

const DEFAULT_WORKSPACE_NAME = '我的工作区';
const DEFAULT_WORKSPACE_TOTAL_SIZE = BigInt(10 * 1024 * 1024 * 1024);

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

      return this.prisma.$transaction((tx) =>
        this.createWorkspaceRecord(tx, userId, dto.name, slug),
      );
    }

    throw new ConflictException('WORKSPACE_SLUG_EXHAUSTED');
  }

  async listWorkspaces(userId: string) {
    const listMemberships = () =>
      this.prisma.workspaceMember.findMany({
        where: { userId, status: 'active', workspace: { status: 'active' } },
        include: { workspace: true },
        orderBy: { joinedAt: 'asc' },
      });

    const memberships = await listMemberships();
    if (memberships.length > 0) return memberships;

    await this.ensureDefaultWorkspace(userId);
    return listMemberships();
  }

  async ensureDefaultWorkspace(userId: string): Promise<void> {
    const existing = await this.prisma.workspaceMember.findFirst({
      where: { userId, status: 'active', workspace: { status: 'active' } },
    });
    if (existing) return;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = `ws-${randomBytes(3).toString('hex')}`;
      if (await this.prisma.workspace.findUnique({ where: { slug } })) continue;

      await this.prisma.$transaction((tx) =>
        this.createWorkspaceRecord(tx, userId, DEFAULT_WORKSPACE_NAME, slug),
      );
      return;
    }
  }

  private async createWorkspaceRecord(
    tx: Prisma.TransactionClient,
    userId: string,
    name: string,
    slug: string,
  ) {
    const workspace = await tx.workspace.create({
      data: { name, slug, ownerId: userId, storageDriver: 'qiniu' },
    });
    await tx.workspaceMember.create({
      data: { workspaceId: workspace.id, userId, role: 'OWNER' },
    });
    await tx.workspaceQuota.create({
      data: {
        workspaceId: workspace.id,
        totalSize: DEFAULT_WORKSPACE_TOTAL_SIZE,
        usedSize: BigInt(0),
        reservedSize: BigInt(0),
        maxFileSize: DEFAULT_WORKSPACE_TOTAL_SIZE,
        maxFileCount: 100000,
      },
    });
    return workspace;
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
