import { AuditService } from '../../src/audit/audit.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('AuditService', () => {
  it('writes normalized audit records', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await service.record({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      action: 'member.role_changed',
      resourceType: 'member',
      resourceId: 'member-1',
      ip: '127.0.0.1',
      userAgent: 'jest',
      requestId: 'request-1',
      before: { role: 'EDITOR' },
      after: { role: 'ADMIN' },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: 'workspace-1',
          action: 'member.role_changed',
          resourceType: 'member',
        }),
      }),
    );
  });

  it('returns paginated audit records', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'audit-1' }]);
    const count = jest.fn().mockResolvedValue(1);
    const prisma = {
      auditLog: { findMany, count },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    const result = await service.list('workspace-1', { page: 2, limit: 10 });
    expect(result).toMatchObject({ items: [{ id: 'audit-1' }], total: 1, page: 2, limit: 10 });
  });
});
