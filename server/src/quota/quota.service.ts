import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAvailable(
    row: { totalSize: bigint; usedSize: bigint; reservedSize: bigint },
    size: bigint,
  ) {
    const available = row.totalSize - row.usedSize - row.reservedSize;
    if (size > available) {
      throw new BadRequestException('WORKSPACE_QUOTA_EXCEEDED');
    }
  }

  async reserve(input: { workspaceId: string; size: bigint }) {
    await this.prisma.$transaction(async (tx) => {
      const quota = await tx.workspaceQuota.findUnique({
        where: { workspaceId: input.workspaceId },
      });

      if (!quota) throw new NotFoundException('WORKSPACE_QUOTA_NOT_FOUND');
      if (input.size > quota.maxFileSize) throw new BadRequestException('FILE_TOO_LARGE');
      this.assertAvailable(quota, input.size);

      await tx.workspaceQuota.update({
        where: { workspaceId: input.workspaceId },
        data: { reservedSize: { increment: input.size } },
      });
    });
  }

  async confirm(input: { workspaceId: string; uploadSessionId: string; size: bigint }) {
    await this.prisma.$transaction(async (tx) => {
      const quota = await tx.workspaceQuota.findUnique({
        where: { workspaceId: input.workspaceId },
      });
      if (!quota) throw new NotFoundException('WORKSPACE_QUOTA_NOT_FOUND');

      await tx.workspaceQuota.update({
        where: { workspaceId: input.workspaceId },
        data: {
          usedSize: { increment: input.size },
          reservedSize: { decrement: input.size },
        },
      });

      await tx.uploadSession.update({
        where: { id: input.uploadSessionId },
        data: { quotaReserved: BigInt(0) },
      });
    });
  }

  async release(input: { workspaceId: string; uploadSessionId: string; size: bigint }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceQuota.update({
        where: { workspaceId: input.workspaceId },
        data: { reservedSize: { decrement: input.size } },
      });

      await tx.uploadSession.update({
        where: { id: input.uploadSessionId },
        data: { quotaReserved: BigInt(0) },
      });
    });
  }

  async getUsage(workspaceId: string) {
    const quota = await this.prisma.workspaceQuota.findUnique({ where: { workspaceId } });
    if (!quota) throw new NotFoundException('WORKSPACE_QUOTA_NOT_FOUND');

    return {
      totalSize: Number(quota.totalSize),
      usedSize: Number(quota.usedSize),
      reservedSize: Number(quota.reservedSize),
      availableSize: Number(quota.totalSize - quota.usedSize - quota.reservedSize),
      maxFileSize: Number(quota.maxFileSize),
      maxFileCount: quota.maxFileCount,
    };
  }
}
