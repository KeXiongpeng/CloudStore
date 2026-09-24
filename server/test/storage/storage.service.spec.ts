import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { StorageModule } from '../../src/storage/storage.module';
import { StorageService } from '../../src/storage/storage.service';
import { MinioStorageDriver } from '../../src/storage/minio-storage.driver';
import { QiniuStorageDriver } from '../../src/storage/qiniu-storage.driver';

function createConfigService(driver: 'minio' | 'qiniu') {
  const values: Record<string, string> = {
    'storage.driver': driver,
    'minio.endpoint': 'http://localhost:9000',
    'minio.region': 'us-east-1',
    'minio.accessKey': 'minioadmin',
    'minio.secretKey': 'minioadmin',
    'minio.bucket': 'clouddrive-local',
    'qiniu.endpoint': 'https://s3.cn-east-1.qiniucs.com',
    'qiniu.accessKey': 'test',
    'qiniu.secretKey': 'test',
    'qiniu.bucket': 'test-bucket',
  };

  return {
    get: jest.fn((token: string, defaultValue?: unknown) => values[token] ?? defaultValue),
    getOrThrow: jest.fn((token: string) => {
      if (!(token in values)) throw new Error(`Missing config ${token}`);
      return values[token];
    }),
  };
}

describe('StorageService', () => {
  it('selects the MinIO driver in local mode', () => {
    const service = new StorageService({
      driver: 'minio',
      minio: new MinioStorageDriver({
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        bucket: 'clouddrive-local',
      }),
      qiniu: new QiniuStorageDriver({
        endpoint: 'https://s3.cn-east-1.qiniucs.com',
        region: 'cn-east-1',
        accessKey: 'test',
        secretKey: 'test',
        bucket: 'test-bucket',
      }),
    });

    expect(service.driverName).toBe('minio');
  });

  it('selects the Qiniu driver in production mode', () => {
    const service = new StorageService({
      driver: 'qiniu',
      minio: new MinioStorageDriver({
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        accessKey: 'minioadmin',
        secretKey: 'minioadmin',
        bucket: 'clouddrive-local',
      }),
      qiniu: new QiniuStorageDriver({
        endpoint: 'https://s3.cn-east-1.qiniucs.com',
        region: 'cn-east-1',
        accessKey: 'test',
        secretKey: 'test',
        bucket: 'test-bucket',
      }),
    });

    expect(service.driverName).toBe('qiniu');
  });
});

it('is constructed by Nest with the storage driver provider', async () => {
  const configService = createConfigService('minio');
  const moduleRef = await Test.createTestingModule({ imports: [StorageModule] })
    .overrideProvider(ConfigService)
    .useValue(configService)
    .compile();

  expect(moduleRef.get(StorageService).driverName).toBe('minio');
  expect(configService.getOrThrow).toHaveBeenCalledWith('storage.driver');
});
