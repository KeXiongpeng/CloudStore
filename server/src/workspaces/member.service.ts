import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WorkspaceActorContext } from './types';
import { InviteMemberDto, RequestContext, UpdateMemberRoleDto } from './dto/member.dto';

@Injectable()
export class MemberService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listMembers(actor: WorkspaceActorContext) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId: actor.workspaceId, status: 'active' },
      include: {
        user: { select: { id: true, email: true, nickname: true, avatarUrl: true } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async listInvitations(actor: WorkspaceActorContext) {
    return this.prisma.workspaceInvitation.findMany({
      where: { workspaceId: actor.workspaceId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async requireTargetMember(workspaceId: string, memberId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { id: memberId },
    });

    if (!member || member.workspaceId !== workspaceId || member.status !== 'active') {
      throw new NotFoundException('WORKSPACE_MEMBER_NOT_FOUND');
    }

    return member;
  }

  async updateMemberRole(
    actor: WorkspaceActorContext,
    memberId: string,
    dto: UpdateMemberRoleDto,
    context: RequestContext,
  ) {
    const target = await this.requireTargetMember(actor.workspaceId, memberId);

    if (target.role === 'OWNER') {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      include: {
        user: { select: { id: true, email: true, nickname: true, avatarUrl: true } },
      },
    });

    await this.auditService.record({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: 'member.role_changed',
      resourceType: 'member',
      resourceId: memberId,
      before: { role: target.role },
      after: { role: dto.role },
      ...context,
    });

    return updated;
  }

  async removeMember(actor: WorkspaceActorContext, memberId: string, context: RequestContext) {
    const target = await this.requireTargetMember(actor.workspaceId, memberId);

    if (target.role === 'OWNER') {
      throw new ForbiddenException('WORKSPACE_OWNER_CANNOT_BE_REMOVED');
    }

    await this.prisma.workspaceMember.delete({ where: { id: memberId } });

    await this.auditService.record({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: 'member.removed',
      resourceType: 'member',
      resourceId: memberId,
      before: { role: target.role, userId: target.userId },
      ...context,
    });

    return { id: memberId };
  }

  async inviteMember(actor: WorkspaceActorContext, dto: InviteMemberDto, context: RequestContext) {
    const email = dto.email.toLowerCase();
    const pending = await this.prisma.workspaceInvitation.findFirst({
      where: { workspaceId: actor.workspaceId, email, status: 'pending' },
    });

    if (pending) {
      throw new ConflictException('WORKSPACE_INVITATION_ALREADY_EXISTS');
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');

    const invitation = await this.prisma.workspaceInvitation.create({
      data: {
        workspaceId: actor.workspaceId,
        email,
        role: dto.role,
        tokenHash,
        invitedBy: actor.userId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    await this.auditService.record({
      workspaceId: actor.workspaceId,
      actorId: actor.userId,
      action: 'member.invited',
      resourceType: 'invitation',
      resourceId: invitation.id,
      after: { email, role: dto.role },
      ...context,
    });

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
      token,
    };
  }

  async acceptInvitation(userId: string, token: string) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash },
    });

    if (!invitation || invitation.status !== 'pending' || invitation.expiresAt <= new Date()) {
      throw new NotFoundException('WORKSPACE_INVITATION_NOT_FOUND');
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId: invitation.workspaceId,
          userId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('WORKSPACE_MEMBER_ALREADY_EXISTS');
    }

    const member = await this.prisma.$transaction(async (tx) => {
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });

      return tx.workspaceMember.create({
        data: {
          workspaceId: invitation.workspaceId,
          userId,
          role: invitation.role,
        },
      });
    });

    await this.auditService.record({
      workspaceId: invitation.workspaceId,
      actorId: userId,
      action: 'member.joined',
      resourceType: 'member',
      resourceId: member.id,
      after: { role: member.role, invitationId: invitation.id },
    });

    return member;
  }
}
