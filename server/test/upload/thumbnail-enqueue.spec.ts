import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  uploadChunk: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  storageObject: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  file: { create: jest.fn(), update: jest.fn() },
  fileVersion: { create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((fn) =>
    fn({
      uploadSession: prisma.uploadSession,
      uploadChunk: prisma.uploadChunk,
      storageObject: prisma.storageObject,
      file: prisma.file,
      fileVersion: prisma.fileVersion,
    }),
  ),
};
const quota = { confirm: jest.fn(), release: jest.fn() };
const storage = { headObject: jest.fn(), completeMultipart: jest.fn(), abortMultipart: jest.fn() };
const audit = { record: jest.fn() };
const workspaces = { requireMembership: jest.fn() };
const queue = { addThumbnailJob: jest.fn().mockResolvedValue(undefined) };

describe('UploadService thumbnail enqueue', () => {
  it('enqueues a thumbnail after successful direct completion', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 'session-1',
      workspaceId: 'w1',
      createdBy: 'u1',
      mode: 'direct',
      strategy: 'normal',
      status: 'uploading',
      size: BigInt(8),
      hash: 'a'.repeat(64),
      hashAlgorithm: 'sha256',
      storageKey: 'key',
      folderId: null,
      filename: 'a.png',
      mimeType: 'image/png',
      quotaReserved: BigInt(8),
      chunks: [],
      file: null,
    });
    storage.headObject.mockResolvedValue({ key: 'key', size: 8 });
    prisma.file.create.mockResolvedValue({ id: 'file-1', urlKey: 'public-key' });
    prisma.fileVersion.create.mockResolvedValue({ id: 'version-1', fileId: 'file-1' });

    const service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
      queue as any,
    );

    await service.complete(
      { userId: 'u1', workspaceId: 'w1', memberId: 'm1', role: 'EDITOR' },
      'session-1',
      {},
    );

    expect(queue.addThumbnailJob).toHaveBeenCalledWith({
      fileVersionId: 'version-1',
      storageKey: 'key',
      mimeType: 'image/png',
      workspaceId: 'w1',
    });
  });
});
