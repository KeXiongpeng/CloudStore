import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Res,
  Query,
  Req,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  buildOAuthRedirectUri,
  getEnabledOAuthProviders,
  isValidOAuthState,
  OAuthProviderName,
} from './oauth.utils';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refresh_token);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@CurrentUser('id') userId: string) {
    return this.authService.logout(userId);
  }

  @Get('providers')
  getProviders() {
    return {
      providers: getEnabledOAuthProviders({
        github: {
          clientId: this.configService.get<string>('github.clientId'),
          clientSecret: this.configService.get<string>('github.clientSecret'),
        },
        google: {
          clientId: this.configService.get<string>('google.clientId'),
          clientSecret: this.configService.get<string>('google.clientSecret'),
        },
        wechat: {
          clientId: this.configService.get<string>('wechat.clientId'),
          clientSecret: this.configService.get<string>('wechat.clientSecret'),
        },
      }),
    };
  }

  @Get('github')
  githubAuth(@Res() res: Response) {
    const clientId = this.configService.get<string>('github.clientId');
    const clientSecret = this.configService.get<string>('github.clientSecret');

    if (!clientId || !clientSecret) {
      return this.redirectError(res, 'provider_not_configured');
    }

    const appUrl = this.configService.get<string>('app.url') || 'http://localhost:3001';
    const redirectUri = buildOAuthRedirectUri(
      appUrl,
      'github',
      this.configService.get<string>('github.redirectUri'),
    );
    const state = this.createState(res, 'github');
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);

    return res.redirect(url.toString());
  }

  @Get('github/callback')
  async githubCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (this.hasProviderError(code, state, req, 'github')) {
      return this.redirectError(res, 'oauth_failed');
    }

    const appUrl = this.configService.get<string>('app.url') || 'http://localhost:3001';
    const redirectUri = buildOAuthRedirectUri(
      appUrl,
      'github',
      this.configService.get<string>('github.redirectUri'),
    );

    if (!this.isValidState(req, res, 'github', state)) {
      return this.redirectError(res, 'invalid_state');
    }

    const result = await this.authService.githubLogin(code, redirectUri);
    return this.redirectSuccess(res, result);
  }

  @Get('google')
  googleAuth(@Res() res: Response) {
    const clientId = this.configService.get<string>('google.clientId');
    const clientSecret = this.configService.get<string>('google.clientSecret');

    if (!clientId || !clientSecret) {
      return this.redirectError(res, 'provider_not_configured');
    }

    const appUrl = this.configService.get<string>('app.url') || 'http://localhost:3001';
    const redirectUri = buildOAuthRedirectUri(
      appUrl,
      'google',
      this.configService.get<string>('google.redirectUri'),
    );
    const state = this.createState(res, 'google');
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);

    return res.redirect(url.toString());
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (this.hasProviderError(code, state, req, 'google')) {
      return this.redirectError(res, 'oauth_failed');
    }

    const appUrl = this.configService.get<string>('app.url') || 'http://localhost:3001';
    const redirectUri = buildOAuthRedirectUri(
      appUrl,
      'google',
      this.configService.get<string>('google.redirectUri'),
    );

    if (!this.isValidState(req, res, 'google', state)) {
      return this.redirectError(res, 'invalid_state');
    }

    const result = await this.authService.googleLogin(code, redirectUri);
    return this.redirectSuccess(res, result);
  }

  @Get('wechat')
  wechatAuth(@Res() res: Response) {
    const clientId = this.configService.get<string>('wechat.clientId');
    const clientSecret = this.configService.get<string>('wechat.clientSecret');

    if (!clientId || !clientSecret) {
      return this.redirectError(res, 'provider_not_configured');
    }

    const appUrl = this.configService.get<string>('app.url') || 'http://localhost:3001';
    const redirectUri = buildOAuthRedirectUri(
      appUrl,
      'wechat',
      this.configService.get<string>('wechat.redirectUri'),
    );
    const state = this.createState(res, 'wechat');
    const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
    url.searchParams.set('appid', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_login');
    url.searchParams.set('state', state);

    return res.redirect(`${url.toString()}#wechat_redirect`);
  }

  @Get('wechat/callback')
  async wechatCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    if (this.hasProviderError(code, state, req, 'wechat')) {
      return this.redirectError(res, 'oauth_failed');
    }

    const appUrl = this.configService.get<string>('app.url') || 'http://localhost:3001';
    const redirectUri = buildOAuthRedirectUri(
      appUrl,
      'wechat',
      this.configService.get<string>('wechat.redirectUri'),
    );

    if (!this.isValidState(req, res, 'wechat', state)) {
      return this.redirectError(res, 'invalid_state');
    }

    const result = await this.authService.wechatLogin(code, redirectUri);
    return this.redirectSuccess(res, result);
  }

  private createState(res: Response, provider: OAuthProviderName): string {
    const state = randomUUID();
    const appUrl = this.configService.get<string>('app.url') || 'http://localhost:3001';
    res.cookie(`oauth_state_${provider}`, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: appUrl.startsWith('https'),
      maxAge: 10 * 60 * 1000,
      path: `/api/auth/${provider}/callback`,
    });
    return state;
  }

  private readCookie(req: Request, name: string): string | undefined {
    return req.cookies?.[name];
  }

  private isValidState(
    req: Request,
    res: Response,
    provider: OAuthProviderName,
    receivedState: string,
  ): boolean {
    const expectedState = this.readCookie(req, `oauth_state_${provider}`);
    const isValid = isValidOAuthState(expectedState, receivedState);
    res.clearCookie(`oauth_state_${provider}`, {
      path: `/api/auth/${provider}/callback`,
    });
    return isValid;
  }

  private hasProviderError(
    code: string,
    state: string,
    req: Request,
    provider: OAuthProviderName,
  ): boolean {
    return !code || !state || !this.readCookie(req, `oauth_state_${provider}`);
  }

  private redirectSuccess(res: Response, result: { access_token: string; refresh_token: string }) {
    const frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:3001');
    return res.redirect(
      `${frontendUrl}/auth/callback?access_token=${encodeURIComponent(
        result.access_token,
      )}&refresh_token=${encodeURIComponent(result.refresh_token)}`,
    );
  }

  private redirectError(res: Response, errorCode: string) {
    const frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:3001');
    return res.redirect(`${frontendUrl}/auth/callback?error=${errorCode}`);
  }
}
