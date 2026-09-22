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
import { buildWechatIdentityEmail, OAuthProviderName } from './oauth.utils';

const FREE_STORAGE_LIMIT = 500 * 1024 * 1024;

interface OAuthLoginResult {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    nickname: string | null;
    role: string;
    tier: string;
  };
}

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
      user: this.serializeUser(user),
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
      user: this.serializeUser(user),
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

  async githubLogin(code: string, redirectUri: string): Promise<OAuthLoginResult> {
    const clientId = this.configService.get<string>('github.clientId');
    const clientSecret = this.configService.get<string>('github.clientSecret');

    const tokenResponse = await firstValueFrom(
      this.httpService.post(
        'https://github.com/login/oauth/access_token',
        {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        },
        { headers: { Accept: 'application/json' } },
      ),
    );

    const accessToken = this.getAccessToken(tokenResponse.data, 'GitHub');

    const userResponse = await firstValueFrom(
      this.httpService.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
        },
      }),
    );

    let email = userResponse.data.email;
    if (!email) {
      const emailResponse = await firstValueFrom(
        this.httpService.get('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
          },
        }),
      );

      const emails = Array.isArray(emailResponse.data) ? emailResponse.data : [];
      email =
        emails.find((item: any) => item.primary && item.verified)?.email ||
        emails.find((item: any) => item.verified)?.email;
    }

    const { id, login, avatar_url } = userResponse.data;
    return this.findOrCreateOAuthUser(
      'github',
      String(id),
      email || `github_${id}@users.noreply.github.com`,
      login,
      avatar_url,
    );
  }

  async googleLogin(code: string, redirectUri: string): Promise<OAuthLoginResult> {
    const clientId = this.configService.get<string>('google.clientId');
    const clientSecret = this.configService.get<string>('google.clientSecret');

    const tokenResponse = await firstValueFrom(
      this.httpService.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    );

    const accessToken = this.getAccessToken(tokenResponse.data, 'Google');

    const userResponse = await firstValueFrom(
      this.httpService.get('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    const { id, email, name, picture } = userResponse.data;
    return this.findOrCreateOAuthUser('google', id, email, name, picture);
  }

  async wechatLogin(code: string, redirectUri: string): Promise<OAuthLoginResult> {
    const appId = this.configService.get<string>('wechat.clientId');
    const secret = this.configService.get<string>('wechat.clientSecret');

    const tokenResponse = await firstValueFrom(
      this.httpService.get('https://api.weixin.qq.com/sns/oauth2/access_token', {
        params: {
          appid: appId,
          secret,
          code,
          grant_type: 'authorization_code',
        },
      }),
    );

    const accessToken = this.getAccessToken(tokenResponse.data, '微信');
    const { openid, unionid } = tokenResponse.data;

    const userResponse = await firstValueFrom(
      this.httpService.get('https://api.weixin.qq.com/sns/userinfo', {
        params: {
          access_token: accessToken,
          openid,
          lang: 'zh_CN',
        },
      }),
    );

    const nickname = userResponse.data.nickname;
    const avatarUrl = userResponse.data.headimgurl;
    const email = buildWechatIdentityEmail(openid, unionid);

    return this.findOrCreateOAuthUser(
      'wechat',
      unionid || openid,
      email,
      nickname,
      avatarUrl,
    );
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

  private getAccessToken(payload: any, providerName: string): string {
    if (payload?.errcode || !payload?.access_token) {
      throw new UnauthorizedException(`${providerName}授权失败`);
    }
    return payload.access_token;
  }

  private serializeUser(user: {
    id: string;
    email: string;
    nickname: string | null;
    role: string;
    tier: string;
  }) {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
      tier: user.tier,
    };
  }

  private async findOrCreateOAuthUser(
    provider: OAuthProviderName,
    providerId: string,
    email: string,
    nickname?: string,
    avatarUrl?: string,
  ): Promise<OAuthLoginResult> {
    const oauthAccount = await this.prisma.oAuthAccount.findUnique({
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
        user: this.serializeUser(user),
      };
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
      if (!existingUser.avatarUrl && avatarUrl) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { avatarUrl },
        });
      }
    } else {
      const newUser = await this.prisma.user.create({
        data: {
          email,
          nickname: nickname || `${provider}_user`,
          passwordHash: null,
          avatarUrl,
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
      throw new UnauthorizedException('OAuth 用户创建失败');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.storeRefreshToken(user.id, tokens.refresh_token);

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user: this.serializeUser(user),
    };
  }
}
