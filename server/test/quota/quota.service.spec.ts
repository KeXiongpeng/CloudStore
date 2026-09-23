import { BadRequestException } from '@nestjs/common';
import { QuotaService } from '../../src/quota/quota.service';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('QuotaService', () => {
  it('rejects reservation when used plus reserved plus size exceeds total', async () => {
    const tx = {
      workspaceQuota: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: 'w1',
          totalSize: BigInt(100),
          usedSize: BigInt(80),
          reservedSize: BigInt(20),
          maxFileSize: BigInt(100),
        }),
      },
    };
    const prisma = { $transaction: jest.fn((fn) => fn(tx)) } as unknown as PrismaService;
    const service = new QuotaService(prisma);

    await expect(service.reserve({ workspaceId: 'w1', size: BigInt(1) })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('reserves available quota', async () => {
    const update = jest.fn().mockResolvedValue({
      usedSize: BigInt(10),
      reservedSize: BigInt(20),
      totalSize: BigInt(100),
    });
    const tx = {
      workspaceQuota: {
        findUnique: jest.fn().mockResolvedValue({
          workspaceId: 'w1',
          totalSize: BigInt(100),
          usedSize: BigInt(10),
          reservedSize: BigInt(10),
          maxFileSize: BigInt(100),
        }),
        update,
      },
    };
    const prisma = { $transaction: jest.fn((fn) => fn(tx)) } as unknown as PrismaService;
    const service = new QuotaService(prisma);

    await service.reserve({ workspaceId: 'w1', size: BigInt(10) });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { reservedSize: { increment: BigInt(10) } },
      }),
    );
  });
});
