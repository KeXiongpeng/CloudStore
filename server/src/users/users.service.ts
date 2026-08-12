import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nickname: true,
        avatarUrl: true,
        role: true,
        tier: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('用户不存在');
    }

    return user;
  }

  async updateMe(userId: string, dto: UpdateUserDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        nickname: dto.nickname,
        avatarUrl: dto.avatarUrl,
      },
    });

    return this.getMe(userId);
  }

  async updatePassword(userId: string, dto: UpdatePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      throw new NotFoundException('用户不存在或未设置密码');
    }

    const isOldPasswordValid = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!isOldPasswordValid) {
      throw new UnauthorizedException('旧密码错误');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    return { message: '密码修改成功' };
  }

  async getQuota(userId: string) {
    const quota = await this.prisma.userQuota.findUnique({
      where: { userId },
    });

    if (!quota) {
      throw new NotFoundException('配额信息不存在');
    }

    return {
      storageLimit: Number(quota.storageLimit),
      storageUsed: Number(quota.storageUsed),
      tier: quota.tier,
      usagePercent: Number(quota.storageUsed) / Number(quota.storageLimit) * 100,
    };
  }
}
