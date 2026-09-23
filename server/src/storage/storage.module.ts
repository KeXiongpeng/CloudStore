import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MinioStorageDriver } from './minio-storage.driver';
import { QiniuStorageDriver } from './qiniu-storage.driver';
import { StorageService } from './storage.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'STORAGE_DRIVERS',
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const minio = new MinioStorageDriver({
          endpoint: configService.getOrThrow<string>('minio.endpoint'),
          region: configService.get<string>('minio.region', 'us-east-1'),
          accessKey: configService.getOrThrow<string>('minio.accessKey'),
          secretKey: configService.getOrThrow<string>('minio.secretKey'),
          bucket: configService.getOrThrow<string>('minio.bucket'),
        });
        const qiniu = new QiniuStorageDriver({
          endpoint: configService.getOrThrow<string>('qiniu.endpoint'),
          region: 'cn-east-1',
          accessKey: configService.getOrThrow<string>('qiniu.accessKey'),
          secretKey: configService.getOrThrow<string>('qiniu.secretKey'),
          bucket: configService.getOrThrow<string>('qiniu.bucket'),
        });

        return {
          driver: configService.getOrThrow<'minio' | 'qiniu'>('storage.driver'),
          minio,
          qiniu,
        };
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
