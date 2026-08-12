import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus, Get, Res, Query, Req } from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

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

  @Get('github')
  githubAuth(@Res() res: Response) {
    const clientId = this.configService.get<string>('github.clientId');
    const redirectUri = encodeURIComponent(
      process.env.GITHUB_REDIRECT_URI || 'http://localhost/api/auth/github/callback',
    );
    const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}`;
    res.redirect(url);
  }

  @Get('github/callback')
  async githubCallback(@Query('code') code: string, @Res() res: Response) {
    const result = await this.authService.githubLogin(code);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost';
    res.redirect(`${frontendUrl}/auth/callback?access_token=${result.access_token}&refresh_token=${result.refresh_token}`);
  }

  @Get('google')
  googleAuth(@Res() res: Response) {
    const clientId = this.configService.get<string>('google.clientId');
    const redirectUri = encodeURIComponent(
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost/api/auth/google/callback',
    );
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=openid email profile`;
    res.redirect(url);
  }

  @Get('google/callback')
  async googleCallback(@Query('code') code: string, @Res() res: Response) {
    const result = await this.authService.googleLogin(code);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost';
    res.redirect(`${frontendUrl}/auth/callback?access_token=${result.access_token}&refresh_token=${result.refresh_token}`);
  }
}
