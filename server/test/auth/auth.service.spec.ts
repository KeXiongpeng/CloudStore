import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';
import { WorkspacesService } from '../../src/workspaces/workspaces.service';
import { of } from 'rxjs';

describe('AuthService.refreshTokens', () => {
  it('maps an expired refresh token to UnauthorizedException', async () => {
    const jwtService = {
      verify: jest.fn().mockImplementation(() => {
        const error = new Error('jwt expired');
        error.name = 'TokenExpiredError';
        throw error;
      }),
    } as unknown as JwtService;
    const configService = {
      get: jest.fn().mockReturnValue('refresh-secret'),
    } as unknown as ConfigService;

    const service = new AuthService(
      {} as PrismaService,
      jwtService,
      configService,
      {} as RedisService,
      {} as HttpService,
      { ensureDefaultWorkspace: jest.fn() } as unknown as WorkspacesService,
    );

    await expect(service.refreshTokens('expired-token')).rejects.toThrow(
      new UnauthorizedException('登录已过期，请重新登录'),
    );
  });

  it('maps an invalid refresh token to UnauthorizedException', async () => {
    const jwtService = {
      verify: jest.fn().mockImplementation(() => {
        const error = new Error('invalid signature');
        error.name = 'JsonWebTokenError';
        throw error;
      }),
    } as unknown as JwtService;
    const configService = {
      get: jest.fn().mockReturnValue('refresh-secret'),
    } as unknown as ConfigService;

    const service = new AuthService(
      {} as PrismaService,
      jwtService,
      configService,
      {} as RedisService,
      {} as HttpService,
      { ensureDefaultWorkspace: jest.fn() } as unknown as WorkspacesService,
    );

    await expect(service.refreshTokens('bad-token')).rejects.toThrow(
      new UnauthorizedException('无效的 refresh token'),
    );
  });
});

describe('AuthService default workspace bootstrap', () => {
  function buildService() {
    const prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      userQuota: { create: jest.fn().mockResolvedValue({}) },
      oAuthAccount: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const jwtService = { signAsync: jest.fn().mockResolvedValue('token') } as unknown as JwtService;
    const configService = {
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue ?? 'secret'),
    } as unknown as ConfigService;
    const redisService = { set: jest.fn().mockResolvedValue(undefined) } as unknown as RedisService;
    const httpService: any = { post: jest.fn(), get: jest.fn() };
    const workspacesService = {
      ensureDefaultWorkspace: jest.fn().mockResolvedValue(undefined),
    } as unknown as WorkspacesService;
    const service = new AuthService(
      prisma as unknown as PrismaService,
      jwtService,
      configService,
      redisService,
      httpService as HttpService,
      workspacesService,
    );
    return { service, prisma, httpService, workspacesService };
  }

  it('creates a default workspace for email registrations', async () => {
    const { service, prisma, workspacesService } = buildService();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.com',
      nickname: 'a',
      role: 'USER',
      tier: 'free',
    });

    await service.register({ email: 'a@b.com', password: 'password123' });

    expect(workspacesService.ensureDefaultWorkspace).toHaveBeenCalledWith('user-1');
  });

  it('creates a default workspace for newly created OAuth users', async () => {
    const { service, prisma, httpService, workspacesService } = buildService();
    httpService.post.mockReturnValue(of({ data: { access_token: 'tok' } }));
    httpService.get.mockReturnValue(
      of({ data: { id: 'g-1', email: 'g@b.com', name: 'G', picture: '' } }),
    );
    const createdUser = {
      id: 'user-9',
      email: 'g@b.com',
      nickname: 'G',
      role: 'USER',
      tier: 'free',
    };
    prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValue(createdUser);
    prisma.user.create.mockResolvedValue(createdUser);

    await service.googleLogin('code', 'https://kxpwty.cn/api/auth/google/callback');

    expect(prisma.user.create).toHaveBeenCalled();
    expect(workspacesService.ensureDefaultWorkspace).toHaveBeenCalledWith('user-9');
  });

  it('does not create a workspace for existing OAuth users', async () => {
    const { service, prisma, httpService, workspacesService } = buildService();
    httpService.post.mockReturnValue(of({ data: { access_token: 'tok' } }));
    httpService.get.mockReturnValue(
      of({ data: { id: 'g-1', email: 'g@b.com', name: 'G', picture: '' } }),
    );
    prisma.oAuthAccount.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'g@b.com',
      nickname: 'G',
      role: 'USER',
      tier: 'free',
    });

    await service.googleLogin('code', 'https://kxpwty.cn/api/auth/google/callback');

    expect(workspacesService.ensureDefaultWorkspace).not.toHaveBeenCalled();
  });
});
