import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { HttpService } from '@nestjs/axios';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RedisService } from '../../src/redis/redis.service';

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
    );

    await expect(service.refreshTokens('bad-token')).rejects.toThrow(
      new UnauthorizedException('无效的 refresh token'),
    );
  });
});
