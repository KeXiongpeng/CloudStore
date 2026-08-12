import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcryptjs';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const FREE_STORAGE_LIMIT = 500 * 1024 * 1024; // 500MB

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private redisService: RedisService,
    private httpService: HttpService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser) {
      throw new ConflictException('该邮箱已被注册');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        nickname: dto.email.split('@')[0],
      },
    });

    await this.prisma.userQuota.create({
      data: {
        userId: user.id,
        storageLimit: FREE_STORAGE_LIMIT,
        tier: 'free',
      },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.storeRefreshToken(user.id, tokens.refresh_token);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        tier: user.tier,
      },
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.storeRefreshToken(user.id, tokens.refresh_token);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        tier: user.tier,
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    const decoded = this.jwtService.verify(refreshToken, {
      secret: this.configService.get<string>('jwt.refreshSecret'),
    });

    const redisKey = `user:${decoded.sub}:refresh`;
    const storedToken = await this.redisService.get(redisKey);

    if (!storedToken || storedToken !== refreshToken) {
      throw new UnauthorizedException('无效的 refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: decoded.sub },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.storeRefreshToken(user.id, tokens.refresh_token);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    };
  }

  async logout(userId: string) {
    await this.redisService.del(`user:${userId}:refresh`);
    return { message: '已成功登出' };
  }

  async generateTokens(userId: string, email: string, role: string) {
    const accessTokenTtl = this.configService.get<number>('jwt.accessTokenTtl', 900);
    const refreshTokenTtl = this.configService.get<number>('jwt.refreshTokenTtl', 604800);

    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, email, role },
        {
          secret: this.configService.get<string>('jwt.secret'),
          expiresIn: accessTokenTtl,
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, email, role },
        {
          secret: this.configService.get<string>('jwt.refreshSecret'),
          expiresIn: refreshTokenTtl,
        },
      ),
    ]);

    return { access_token, refresh_token };
  }

  private async storeRefreshToken(userId: string, refreshToken: string) {
    const refreshTokenTtl = this.configService.get<number>('jwt.refreshTokenTtl', 604800);
    await this.redisService.set(`user:${userId}:refresh`, refreshToken, refreshTokenTtl);
  }

  private async findOrCreateOAuthUser(provider: 'github' | 'google', providerId: string, email: string, nickname?: string) {
    let oauthAccount = await this.prisma.oAuthAccount.findUnique({
      where: {
        provider_providerId: {
          provider,
          providerId,
        },
      },
      include: { user: true },
    });

    if (oauthAccount) {
      const user = oauthAccount.user;
      const tokens = await this.generateTokens(user.id, user.email, user.role);
      await this.storeRefreshToken(user.id, tokens.refresh_token);
      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        user: {
          id: user.id,
          email: user.email,
          nickname: user.nickname,
          role: user.role,
          tier: user.tier,
        },
      };
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const newUser = await this.prisma.user.create({
        data: {
          email,
          nickname: nickname || email.split('@')[0],
          passwordHash: null,
        },
      });

      await this.prisma.userQuota.create({
        data: {
          userId: newUser.id,
          storageLimit: FREE_STORAGE_LIMIT,
          tier: 'free',
        },
      });

      userId = newUser.id;
    }

    await this.prisma.oAuthAccount.create({
      data: {
        userId,
        provider,
        providerId,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('用户创建失败');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.storeRefreshToken(user.id, tokens.refresh_token);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        role: user.role,
        tier: user.tier,
      },
    };
  }

  async githubLogin(code: string) {
    const clientId = this.configService.get<string>('github.clientId');
    const clientSecret = this.configService.get<string>('github.clientSecret');

    const tokenResponse = await firstValueFrom(
      this.httpService.post('https://github.com/login/oauth/access_token', {
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }, {
        headers: { Accept: 'application/json' },
      }),
    );

    const accessToken = tokenResponse.data.access_token;

    const userResponse = await firstValueFrom(
      this.httpService.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    const { id: githubId, email, login } = userResponse.data;
    return this.findOrCreateOAuthUser('github', String(githubId), email || `github_${githubId}@placeholder.com`, login);
  }

  async googleLogin(code: string) {
    const clientId = this.configService.get<string>('google.clientId');
    const clientSecret = this.configService.get<string>('google.clientSecret');

    const tokenResponse = await firstValueFrom(
      this.httpService.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost/api/auth/google/callback',
        grant_type: 'authorization_code',
      }),
    );

    const accessToken = tokenResponse.data.access_token;

    const userResponse = await firstValueFrom(
      this.httpService.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    const { id: googleId, email, name } = userResponse.data;
    return this.findOrCreateOAuthUser('google', googleId, email, name);
  }
}
