import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { configuration, configValidationSchema } from './common/config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { S3Module } from './s3/s3.module';
import { FilesModule } from './files/files.module';
import { PublicModule } from './public/public.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: join(__dirname, '..', '.env'),
      load: [configuration],
      validationSchema: configValidationSchema,
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    UsersModule,
    S3Module,
    FilesModule,
    PublicModule,
    ApiKeysModule,
    AdminModule,
  ],
})
export class AppModule {}
