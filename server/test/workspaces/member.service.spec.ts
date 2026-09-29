import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MemberService } from '../../src/workspaces/member.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';

const prisma: any = {
  workspaceMember: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
  },
  workspaceInvitation: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};
const audit = { record: jest.fn().mockResolvedValue(undefined) };

describe('MemberService authorization and invitations', () => {
  let service: MemberService;
  const actor = {
    userId: 'admin',
    workspaceId: 'w1',
    memberId: 'admin-member',
    role: 'ADMIN' as const,
  };
  const context = { ip: '127.0.0.1', userAgent: 'jest', requestId: 'r1' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MemberService(prisma as PrismaService, audit as unknown as AuditService);
  });

  it('rejects ADMIN attempts to change OWNER role', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'owner-member',
      workspaceId: 'w1',
      userId: 'owner',
      role: 'OWNER',
      status: 'active',
    });

    await expect(
      service.updateMemberRole(actor, 'owner-member', { role: 'EDITOR' }, context),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects removal of an OWNER', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'owner-member',
      workspaceId: 'w1',
      userId: 'owner',
      role: 'OWNER',
      status: 'active',
    });

    await expect(service.removeMember(actor, 'owner-member', context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects duplicate pending invitations', async () => {
    prisma.workspaceInvitation.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.inviteMember(actor, { email: 'user@example.com', role: 'VIEWER' }, context),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects expired invitations', async () => {
    prisma.workspaceInvitation.findUnique.mockResolvedValue({
      id: 'invite-1',
      tokenHash: 'hash',
      status: 'pending',
      expiresAt: new Date(Date.now() - 1000),
      workspaceId: 'w1',
      role: 'EDITOR',
    });

    await expect(service.acceptInvitation('user-1', 'token')).rejects.toThrow(NotFoundException);
  });

  it('updates a member role and records audit', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'w1',
      userId: 'u2',
      role: 'VIEWER',
      status: 'active',
    });
    prisma.workspaceMember.update.mockResolvedValue({ id: 'member-1', role: 'EDITOR' });

    const result = await service.updateMemberRole(actor, 'member-1', { role: 'EDITOR' }, context);

    expect(result).toMatchObject({ id: 'member-1', role: 'EDITOR' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member.role_changed',
        resourceId: 'member-1',
        before: { role: 'VIEWER' },
        after: { role: 'EDITOR' },
      }),
    );
  });
});
