import { MinioStorageDriver } from './minio-storage.driver';

describe('MinioStorageDriver', () => {
  it('signs browser upload URLs with the public endpoint while keeping the internal client separate', async () => {
    const driver = new MinioStorageDriver({
      endpoint: 'http://minio:9000',
      publicEndpoint: 'http://localhost:39000',
      region: 'us-east-1',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'cloudstore-prod-local',
    });

    const url = await driver.createDirectPutUrl({
      key: 'smoke/example.md',
      contentType: 'text/markdown',
      expiresInSeconds: 600,
    });

    expect(url.startsWith('http://localhost:39000/cloudstore-prod-local/smoke/example.md')).toBe(
      true,
    );
    expect(url).toContain('X-Amz-Signature=');
  });

  it('uses the internal endpoint for signed URLs when no public endpoint is configured', async () => {
    const driver = new MinioStorageDriver({
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      accessKey: 'minioadmin',
      secretKey: 'minioadmin',
      bucket: 'cloudstore-prod-local',
    });

    const url = await driver.createDirectPutUrl({
      key: 'smoke/example.md',
      contentType: 'text/markdown',
      expiresInSeconds: 600,
    });

    expect(url.startsWith('http://minio:9000/cloudstore-prod-local/smoke/example.md')).toBe(true);
  });
});
