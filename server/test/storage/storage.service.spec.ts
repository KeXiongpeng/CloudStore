import { StorageService } from '../../src/storage/storage.service';
import { MinioStorageDriver } from '../../src/storage/minio-storage.driver';
import { QiniuStorageDriver } from '../../src/storage/qiniu-storage.driver';

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
