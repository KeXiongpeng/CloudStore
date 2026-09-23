import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspacesService } from '../../src/workspaces/workspaces.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  const prisma = {
    workspace: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
    },
    workspaceMember: { findUnique: jest.fn(), create: jest.fn() },
    workspaceQuota: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [WorkspacesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(WorkspacesService);
  });

  it('requires an active membership', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue(null);
    await expect(service.requireMembership('workspace-1', 'user-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects disabled members', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'EDITOR',
      status: 'disabled',
      workspace: { status: 'active' },
    });
    await expect(service.requireMembership('workspace-1', 'user-1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns an actor context for active members', async () => {
    prisma.workspaceMember.findUnique.mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      role: 'EDITOR',
      status: 'active',
      workspace: { status: 'active' },
    });
    await expect(service.requireMembership('workspace-1', 'user-1')).resolves.toMatchObject({
      memberId: 'member-1',
      role: 'EDITOR',
    });
  });

  it('rejects workspace deletion by non-owner', async () => {
    await expect(
      service.deleteWorkspace({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        memberId: 'member-1',
        role: 'ADMIN',
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('WorkspacesService.createWorkspace quota bootstrap', () => {
  it('creates a workspace quota in the same transaction', async () => {
    const prisma: any = {
      workspace: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'workspace-1' }),
      },
      workspaceMember: {
        create: jest.fn().mockResolvedValue({ id: 'member-1' }),
      },
      workspaceQuota: {
        create: jest.fn().mockResolvedValue({ id: 'quota-1' }),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [WorkspacesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    const service = moduleRef.get(WorkspacesService);

    await service.createWorkspace('user-1', { name: 'Upload Team' });

    expect(prisma.workspaceQuota.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: 'workspace-1' }),
      }),
    );
  });
});
