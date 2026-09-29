import { Test } from '@nestjs/testing';
import { QueueModule } from '../../src/queue/queue.module';

describe('QueueModule', () => {
  it('boots as a standalone worker application with mapped storage config', async () => {
    process.env.STORAGE_DRIVER = 'minio';
    process.env.MINIO_ENDPOINT = 'http://localhost:9000';
    process.env.MINIO_REGION = 'us-east-1';
    process.env.MINIO_ACCESS_KEY = 'minioadmin';
    process.env.MINIO_SECRET_KEY = 'minioadmin';
    process.env.MINIO_BUCKET = 'clouddrive-local';
    process.env.QINIU_ENDPOINT = 'https://s3.cn-east-1.qiniucs.com';
    process.env.QINIU_ACCESS_KEY = 'test';
    process.env.QINIU_SECRET_KEY = 'test';
    process.env.QINIU_BUCKET = 'test-bucket';
    process.env.DATABASE_URL ||= 'postgresql://localhost:5433/cloud_storage';
    process.env.JWT_SECRET ||= 'test-secret';
    process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';

    const moduleRef = await Test.createTestingModule({ imports: [QueueModule] }).compile();
    await moduleRef.init();
    await moduleRef.close();
  });
});
