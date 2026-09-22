import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, Tier } from '@prisma/client';

const FREE_STORAGE_LIMIT = 500 * 1024 * 1024;
const VIP_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024;

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async getUsers(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          email: true,
          nickname: true,
          avatarUrl: true,
          role: true,
          tier: true,
          createdAt: true,
          quota: {
            select: {
              storageLimit: true,
              storageUsed: true,
            },
          },
          _count: {
            select: {
              files: true,
            },
          },
        },
      }),
      this.prisma.user.count(),
    ]);

    return {
      items: users.map((u) => ({
        ...u,
        quota: u.quota
          ? {
              storageLimit: Number(u.quota.storageLimit),
              storageUsed: Number(u.quota.storageUsed),
            }
          : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateUser(userId: string, role?: Role, tier?: Tier) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    const updateData: Record<string, any> = {};

    if (role !== undefined) {
      updateData.role = role;
    }

    if (tier !== undefined) {
      updateData.tier = tier;

      const newLimit = tier === Tier.vip ? VIP_STORAGE_LIMIT : FREE_STORAGE_LIMIT;
      await this.prisma.userQuota.upsert({
        where: { userId },
        create: {
          userId,
          storageLimit: newLimit,
          tier,
        },
        update: {
          storageLimit: newLimit,
          tier,
        },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return { message: '用户信息已更新' };
  }

  async disableUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    if (user.role === Role.admin) {
      throw new BadRequestException('不能禁用管理员账户');
    }

    await this.prisma.file.deleteMany({
      where: { userId },
    });

    await this.prisma.userQuota.deleteMany({
      where: { userId },
    });

    await this.prisma.apiKey.deleteMany({
      where: { userId },
    });

    await this.prisma.user.delete({
      where: { id: userId },
    });

    return { message: '用户已禁用' };
  }

  async getStats() {
    const [totalUsers, totalFiles, totalSizeResult, totalViewsResult, totalDownloadsResult] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.file.count({ where: { deletedAt: null } }),
        this.prisma.file.aggregate({
          where: { deletedAt: null },
          _sum: { fileSize: true },
        }),
        this.prisma.file.aggregate({
          where: { deletedAt: null },
          _sum: { viewCount: true },
        }),
        this.prisma.file.aggregate({
          where: { deletedAt: null },
          _sum: { downloadCount: true },
        }),
      ]);

    return {
      totalUsers,
      totalFiles,
      totalStorage: Number(totalSizeResult._sum.fileSize || 0),
      totalViews: totalViewsResult._sum.viewCount || 0,
      totalDownloads: totalDownloadsResult._sum.downloadCount || 0,
    };
  }
}
