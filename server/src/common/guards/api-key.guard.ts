import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { createHash } from 'crypto';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const apiKey = request.headers['x-api-key'] as string;

    if (!apiKey) {
      throw new UnauthorizedException('缺少 API Key');
    }

    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    const apiKeyRecord = await this.prisma.apiKey.findFirst({
      where: { keyHash },
      include: { user: true },
    });

    if (!apiKeyRecord) {
      throw new UnauthorizedException('无效的 API Key');
    }

    await this.prisma.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsed: new Date() },
    });

    (request as any).user = {
      id: apiKeyRecord.user.id,
      email: apiKeyRecord.user.email,
      role: apiKeyRecord.user.role,
      tier: apiKeyRecord.user.tier,
    };

    return true;
  }
}
