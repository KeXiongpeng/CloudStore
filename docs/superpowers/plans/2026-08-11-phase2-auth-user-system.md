# Phase 2: 后端认证 + 用户系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现完整的用户认证系统，包括邮箱注册/登录、JWT 鉴权、OAuth2（GitHub/Google）第三方登录、用户信息管理，以及 JWT Guard 和 Admin Guard。

**Architecture:** NestJS 模块化架构。AuthModule 负责注册/登录/OAuth/JWT刷新，UsersModule 负责用户信息/配额查询，PrismaModule 提供数据库访问，RedisModule 提供缓存。JWT 策略通过 Passport 实现，Access Token 有效期 15 分钟，Refresh Token 有效期 7 天存储在 Redis。

**Tech Stack:** NestJS 10, TypeScript, Prisma ORM, PostgreSQL 16, Redis 7, @nestjs/jwt, @nestjs/passport, passport-jwt, bcrypt, @nestjs/passport

## Global Constraints

- 前端: React + Next.js (App Router) + TailwindCSS + TypeScript
- 后端: NestJS + TypeScript + Prisma ORM
- 数据库: PostgreSQL 16
- 缓存: Redis 7
- 对象存储: 七牛云 S3 兼容接口
- 部署: Docker Compose + Nginx
- 所有环境变量通过 .env 管理
- Prisma Schema 已在 Phase 1 定义（users, oauth_accounts, user_quotas 表）
- NestJS 全局前缀 `/api`，端口 3000
- 配置通过 @nestjs/config + Joi 验证

## Prerequisites

Phase 1 必须已完成：NestJS 脚手架、Prisma Schema、Docker Compose 可运行。

---

## File Structure Overview

```
server/src/
├── main.ts                          # 修改：注册 AppModule 变更
├── app.module.ts                    # 修改：导入 AuthModule, UsersModule, PrismaModule, RedisModule
├── common/
│   ├── config/
│   │   └── configuration.ts        # 修改：新增 GITHUB_CLIENT_ID 等环境变量验证
│   ├── guards/
│   │   ├── jwt-auth.guard.ts        # JWT 认证守卫
│   │   └── admin-role.guard.ts      # Admin 角色守卫
│   ├── decorators/
│   │   ├── current-user.decorator.ts   # @CurrentUser() 参数装饰器
│   │   └── roles.decorator.ts          # @Roles('admin') 角色装饰器
│   └── interfaces/
│       └── jwt-payload.interface.ts    # JWT payload 类型定义
├── prisma/
│   ├── prisma.module.ts             # Prisma 服务模块
│   └── prisma.service.ts            # Prisma 服务（封装 PrismaClient）
├── redis/
│   ├── redis.module.ts              # Redis 模块
│   └── redis.service.ts             # Redis 服务
├── auth/
│   ├── auth.module.ts               # 认证模块
│   ├── auth.controller.ts           # 认证控制器
│   ├── auth.service.ts              # 认证服务
│   ├── strategies/
│   │   └── jwt.strategy.ts          # JWT Passport 策略
│   └── dto/
│       ├── register.dto.ts          # 注册 DTO
│       ├── login.dto.ts             # 登录 DTO
│       └── refresh-token.dto.ts     # 刷新 Token DTO
└── users/
    ├── users.module.ts              # 用户模块
    ├── users.controller.ts         # 用户控制器
    ├── users.service.ts             # 用户服务
    └── dto/
        ├── update-user.dto.ts       # 更新用户信息 DTO
        └── update-password.dto.ts   # 修改密码 DTO
```

---

### Task 1: 基础设施 — PrismaModule + RedisModule + Guards + Decorators

**Files:**
- Create: `server/src/prisma/prisma.module.ts`
- Create: `server/src/prisma/prisma.service.ts`
- Create: `server/src/redis/redis.module.ts`
- Create: `server/src/redis/redis.service.ts`
- Create: `server/src/common/guards/jwt-auth.guard.ts`
- Create: `server/src/common/guards/admin-role.guard.ts`
- Create: `server/src/common/decorators/current-user.decorator.ts`
- Create: `server/src/common/decorators/roles.decorator.ts`
- Create: `server/src/common/interfaces/jwt-payload.interface.ts`
- Modify: `server/src/common/config/configuration.ts`（新增 GitHub/Google OAuth 环境变量）
- Modify: `server/package.json`（新增依赖）

**Interfaces:**
- Consumes: Prisma Schema（Phase 1 Task 3）
- Produces: `PrismaService` — 所有后续 Task 通过此服务访问数据库
- Produces: `RedisService` — 后续 Task 通过此服务操作 Redis（存储 Refresh Token）
- Produces: `JwtAuthGuard` — 后续 Controller 通过 `@UseGuards(JwtAuthGuard)` 保护路由
- Produces: `AdminRoleGuard` — 后续 Controller 通过 `@UseGuards(AdminRoleGuard)` 保护管理路由
- Produces: `@CurrentUser()` — 后续 Controller 通过此装饰器获取当前用户

- [ ] **Step 1: 修改 `server/package.json` 新增依赖**

在 `dependencies` 中添加：

```json
"@nestjs/jwt": "^10.2.0",
"@nestjs/passport": "^10.0.3",
"@nestjs/platform-express": "^10.3.0",
"bcrypt": "^5.1.1",
"ioredis": "^5.3.2",
"passport": "^0.7.0",
"passport-jwt": "^4.0.1"
```

在 `devDependencies` 中添加：

```json
"@types/bcrypt": "^5.0.2",
"@types/passport-jwt": "^4.0.1"
```

- [ ] **Step 2: 修改 `server/src/common/config/configuration.ts` 新增 OAuth 环境变量**

在 `configuration()` 函数返回对象中新增：

```typescript
github: {
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
},
google: {
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
},
admin: {
  email: process.env.ADMIN_EMAIL || 'admin@example.com',
  password: process.env.ADMIN_PASSWORD || 'admin123456',
},
```

在 `configValidationSchema` 中新增：

```typescript
GITHUB_CLIENT_ID: Joi.string().optional(),
GITHUB_CLIENT_SECRET: Joi.string().optional(),
GOOGLE_CLIENT_ID: Joi.string().optional(),
GOOGLE_CLIENT_SECRET: Joi.string().optional(),
ADMIN_EMAIL: Joi.string().default('admin@example.com'),
ADMIN_PASSWORD: Joi.string().default('admin123456'),
```

- [ ] **Step 3: 创建 `server/src/common/interfaces/jwt-payload.interface.ts`**

```typescript
export interface JwtPayload {
  sub: string;  // user id
  email: string;
  role: string;
}
```

- [ ] **Step 4: 创建 `server/src/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    console.log('Prisma connected to database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

- [ ] **Step 5: 创建 `server/src/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 6: 创建 `server/src/redis/redis.service.ts`**

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private client: Redis;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('redis.host', 'redis');
    const port = this.configService.get<number>('redis.port', 6379);

    this.client = new Redis({
      host,
      port,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });

    this.client.on('connect', () => {
      console.log('Redis connected');
    });

    this.client.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
  }

  getClient(): Redis {
    return this.client;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}
```

- [ ] **Step 7: 创建 `server/src/redis/redis.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

- [ ] **Step 8: 创建 `server/src/common/guards/jwt-auth.guard.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
```

- [ ] **Step 9: 创建 `server/src/common/guards/admin-role.guard.ts`**

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';

@Injectable()
export class AdminRoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    return requiredRoles.includes(user.role);
  }
}
```

- [ ] **Step 10: 创建 `server/src/common/decorators/current-user.decorator.ts`**

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
```

- [ ] **Step 11: 创建 `server/src/common/decorators/roles.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 12: 修改 `server/src/app.module.ts` 导入新模块**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration, configValidationSchema } from './common/config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: configValidationSchema,
    }),
    PrismaModule,
    RedisModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 13: 提交**

```bash
git add server/
git commit -m "feat: add PrismaModule, RedisModule, JWT guard, and admin guard"
```

---

### Task 2: AuthModule — 注册、登录、JWT 策略、Token 刷新

**Files:**
- Create: `server/src/auth/auth.module.ts`
- Create: `server/src/auth/auth.service.ts`
- Create: `server/src/auth/auth.controller.ts`
- Create: `server/src/auth/strategies/jwt.strategy.ts`
- Create: `server/src/auth/dto/register.dto.ts`
- Create: `server/src/auth/dto/login.dto.ts`
- Create: `server/src/auth/dto/refresh-token.dto.ts`
- Modify: `server/src/app.module.ts`（导入 AuthModule）
- Modify: `server/prisma/seed.ts`（使用 bcrypt 哈希密码）

**Interfaces:**
- Consumes: `PrismaService`（Task 1）
- Consumes: `RedisService`（Task 1）
- Consumes: `JwtAuthGuard`（Task 1）
- Produces: `POST /api/auth/register` — 注册接口
- Produces: `POST /api/auth/login` — 登录接口，返回 `{ access_token, refresh_token }`
- Produces: `POST /api/auth/refresh` — 刷新 Token 接口
- Produces: `POST /api/auth/logout` — 登出接口
- Produces: `AuthService.generateTokens(userId, email, role)` — 后续 Phase 调用生成 Token

- [ ] **Step 1: 创建 `server/src/auth/dto/register.dto.ts`**

```typescript
import { IsEmail, IsNotEmpty, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少 6 个字符' })
  password: string;
}
```

- [ ] **Step 2: 创建 `server/src/auth/dto/login.dto.ts`**

```typescript
import { IsEmail, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsNotEmpty({ message: '密码不能为空' })
  password: string;
}
```

- [ ] **Step 3: 创建 `server/src/auth/dto/refresh-token.dto.ts`**

```typescript
import { IsNotEmpty } from 'class-validator';

export class RefreshTokenDto {
  @IsNotEmpty({ message: 'refresh_token 不能为空' })
  refresh_token: string;
}
```

- [ ] **Step 4: 创建 `server/src/auth/strategies/jwt.strategy.ts`**

```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      tier: user.tier,
    };
  }
}
```

- [ ] **Step 5: 创建 `server/src/auth/auth.service.ts`**

```typescript
import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as bcrypt from 'bcrypt';
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
}
```

- [ ] **Step 6: 创建 `server/src/auth/auth.controller.ts`**

```typescript
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
```

- [ ] **Step 7: 创建 `server/src/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<number>('jwt.accessTokenTtl', 900),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 8: 修改 `server/src/app.module.ts` 导入 AuthModule**

在 `imports` 数组中添加 `AuthModule`：

```typescript
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // ... 已有模块
    AuthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 9: 修改 `server/prisma/seed.ts` 使用 bcrypt**

```typescript
import { PrismaClient, Role, Tier } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const FREE_STORAGE_LIMIT = 500 * 1024 * 1024; // 500MB
const VIP_STORAGE_LIMIT = 10 * 1024 * 1024 * 1024; // 10GB

async function main() {
  console.log('Seeding database...');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123456';

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (existingAdmin) {
    console.log('Admin user already exists, skipping...');
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash,
        nickname: 'Admin',
        role: Role.admin,
        tier: Tier.vip,
      },
    });

    await prisma.userQuota.create({
      data: {
        userId: admin.id,
        storageLimit: VIP_STORAGE_LIMIT,
        tier: Tier.vip,
      },
    });

    console.log(`Admin user created: ${admin.email}`);
  }

  console.log('Seeding completed.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 10: 提交**

```bash
git add server/
git commit -m "feat: add AuthModule with register, login, JWT strategy, and token refresh"
```

---

### Task 3: OAuth2 第三方登录（GitHub + Google）

**Files:**
- Modify: `server/package.json`（新增依赖）
- Modify: `server/src/common/config/configuration.ts`（已在 Task 1 中添加，此处无需修改）
- Modify: `server/src/auth/auth.module.ts`（注册 OAuth 控制器）
- Modify: `server/src/auth/auth.service.ts`（新增 OAuth 方法）
- Create: `server/src/auth/auth.controller.ts`（新增 OAuth 路由）

**Interfaces:**
- Consumes: `PrismaService`（Task 1）
- Consumes: `RedisService`（Task 1）
- Produces: `GET /api/auth/github` — GitHub OAuth2 授权入口
- Produces: `GET /api/auth/github/callback` — GitHub OAuth2 回调
- Produces: `GET /api/auth/google` — Google OAuth2 授权入口
- Produces: `GET /api/auth/google/callback` — Google OAuth2 回调

- [ ] **Step 1: 修改 `server/package.json` 新增依赖**

在 `dependencies` 中添加：

```json
"@nestjs/axios": "^3.0.2"
```

- [ ] **Step 2: 修改 `server/src/auth/auth.service.ts` 新增 OAuth 方法**

在 `AuthService` 类中添加以下方法：

```typescript
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// 在 constructor 中注入 HttpService:
// constructor(
//   ...,
//   private httpService: HttpService,
// ) {}

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

  const userId = existingUser
    ? existingUser.id
    : (
        await this.prisma.user.create({
          data: {
            email,
            nickname: nickname || email.split('@')[0],
            passwordHash: null,
          },
        }).then(async (user) => {
          await this.prisma.userQuota.create({
            data: {
              userId: user.id,
              storageLimit: FREE_STORAGE_LIMIT,
              tier: 'free',
            },
          });
          return user.id;
        })
      );

  await this.prisma.oAuthAccount.create({
    data: {
      userId,
      provider,
      providerId,
    },
  });

  const user = await this.prisma.user.findUnique({ where: { id: userId } });
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
```

- [ ] **Step 3: 修改 `server/src/auth/auth.controller.ts` 新增 OAuth 路由**

在 `AuthController` 中添加：

```typescript
import { Res, Query, Get, Req } from '@nestjs/common';
import { Request, Response } from 'express';

// 在 constructor 中注入 ConfigService:
// constructor(
//   private readonly authService: AuthService,
//   private readonly configService: ConfigService,
// ) {}

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
```

- [ ] **Step 4: 修改 `server/src/auth/auth.module.ts` 导入 HttpModule**

```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { ConfigService, ConfigModule } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    HttpModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<number>('jwt.accessTokenTtl', 900),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

- [ ] **Step 5: 提交**

```bash
git add server/
git commit -m "feat: add GitHub and Google OAuth2 login"
```

---

### Task 4: UsersModule — 用户信息管理 + 配额查询

**Files:**
- Create: `server/src/users/users.module.ts`
- Create: `server/src/users/users.service.ts`
- Create: `server/src/users/users.controller.ts`
- Create: `server/src/users/dto/update-user.dto.ts`
- Create: `server/src/users/dto/update-password.dto.ts`
- Modify: `server/src/app.module.ts`（导入 UsersModule）

**Interfaces:**
- Consumes: `PrismaService`（Task 1）
- Consumes: `JwtAuthGuard` + `@CurrentUser()`（Task 1）
- Produces: `GET /api/users/me` — 获取当前用户信息
- Produces: `PATCH /api/users/me` — 更新昵称/头像
- Produces: `PATCH /api/users/me/password` — 修改密码
- Produces: `GET /api/users/me/quota` — 获取配额使用情况

- [ ] **Step 1: 创建 `server/src/users/dto/update-user.dto.ts`**

```typescript
import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsUrl({}, { message: '头像地址格式不正确' })
  avatarUrl?: string;
}
```

- [ ] **Step 2: 创建 `server/src/users/dto/update-password.dto.ts`**

```typescript
import { IsNotEmpty, MinLength } from 'class-validator';

export class UpdatePasswordDto {
  @IsNotEmpty({ message: '旧密码不能为空' })
  oldPassword: string;

  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(6, { message: '新密码至少 6 个字符' })
  newPassword: string;
}
```

- [ ] **Step 3: 创建 `server/src/users/users.service.ts`**

```typescript
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
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
```

- [ ] **Step 4: 创建 `server/src/users/users.controller.ts`**

```typescript
import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser('id') userId: string) {
    return this.usersService.getMe(userId);
  }

  @Patch('me')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.usersService.updateMe(userId, dto);
  }

  @Patch('me/password')
  updatePassword(@CurrentUser('id') userId: string, @Body() dto: UpdatePasswordDto) {
    return this.usersService.updatePassword(userId, dto);
  }

  @Get('me/quota')
  getQuota(@CurrentUser('id') userId: string) {
    return this.usersService.getQuota(userId);
  }
}
```

- [ ] **Step 5: 创建 `server/src/users/users.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: 修改 `server/src/app.module.ts` 导入 UsersModule**

```typescript
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // ... 已有模块
    UsersModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 7: 提交**

```bash
git add server/
git commit -m "feat: add UsersModule with profile, password, and quota endpoints"
```

---

## 验证清单

完成所有 Task 后，执行以下验证：

1. **安装新增依赖：**
   ```bash
   cd server && npm install
   ```

2. **运行数据库迁移和种子：**
   ```bash
   cd server && npx prisma migrate dev --name init && npx prisma db seed
   ```

3. **启动 NestJS 开发服务器：**
   ```bash
   cd server && npm run start:dev
   ```

4. **验证注册：**
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123456"}'
   ```
   预期：返回 `{ access_token, refresh_token, user: { id, email, nickname, role, tier } }`

5. **验证登录：**
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123456"}'
   ```
   预期：返回 `{ access_token, refresh_token, user }`

6. **验证 JWT 鉴权 — 获取用户信息：**
   ```bash
   curl http://localhost:3000/api/users/me \
     -H "Authorization: Bearer <access_token>"
   ```
   预期：返回当前用户信息

7. **验证刷新 Token：**
   ```bash
   curl -X POST http://localhost:3000/api/auth/refresh \
     -H "Content-Type: application/json" \
     -d '{"refresh_token":"<refresh_token>"}'
   ```
   预期：返回新的 `{ access_token, refresh_token }`

8. **验证配额查询：**
   ```bash
   curl http://localhost:3000/api/users/me/quota \
     -H "Authorization: Bearer <access_token>"
   ```
   预期：返回 `{ storageLimit: 524288000, storageUsed: 0, tier: "free", usagePercent: 0 }`

9. **验证修改密码：**
   ```bash
   curl -X PATCH http://localhost:3000/api/users/me/password \
     -H "Authorization: Bearer <access_token>" \
     -H "Content-Type: application/json" \
     -d '{"oldPassword":"test123456","newPassword":"newpass123"}'
   ```
   预期：返回 `{ message: "密码修改成功" }`
