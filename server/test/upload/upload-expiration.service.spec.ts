import { UploadExpirationService } from '../../src/upload/upload-expiration.service';

const prisma: any = {
  uploadSession: { findMany: jest.fn(), update: jest.fn() },
};
const quota = { release: jest.fn() };
const storage = { abortMultipart: jest.fn() };
const audit = { record: jest.fn() };
const redis = { acquireLock: jest.fn(), releaseLock: jest.fn() };

describe('UploadExpirationService', () => {
  it('expires due sessions and releases quota', async () => {
    prisma.uploadSession.findMany.mockResolvedValue([
      {
        id: 's1',
        workspaceId: 'w1',
        mode: 'multipart',
        status: 'uploading',
        providerUploadId: 'mp-1',
        storageKey: 'key',
        quotaReserved: BigInt(10),
        createdBy: 'u1',
        size: BigInt(10),
      },
    ]);

    const service = new UploadExpirationService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      redis as any,
    );
    const result = await service.expireDueSessions(new Date('2026-01-01T00:00:00Z'));

    expect(result).toEqual({ expiredCount: 1 });
    expect(storage.abortMultipart).toHaveBeenCalledWith({ key: 'key', uploadId: 'mp-1' });
    expect(quota.release).toHaveBeenCalledWith({
      workspaceId: 'w1',
      uploadSessionId: 's1',
      size: BigInt(10),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'upload.expired', resourceId: 's1' }),
    );
  });

  it('acquires and releases a unique merge lock', async () => {
    redis.acquireLock.mockResolvedValue(true);
    const service = new UploadExpirationService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      redis as any,
    );

    const value = await service.acquireMergeLock('s1');

    await service.releaseMergeLock('s1', value);
    expect(redis.acquireLock).toHaveBeenCalledWith('upload:merge:s1', value, 120);
    expect(redis.releaseLock).toHaveBeenCalledWith('upload:merge:s1', value);
  });
});
