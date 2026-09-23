import { ConflictException, NotFoundException } from '@nestjs/common';
import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { findFirst: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
  uploadChunk: { findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  storageObject: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  file: { create: jest.fn(), update: jest.fn() },
  fileVersion: { create: jest.fn() },
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

describe('UploadService completion', () => {
  let service: UploadService;
  const actor = { userId: 'u1', workspaceId: 'w1', memberId: 'm1', role: 'EDITOR' as const };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UploadService(
      prisma,
      quota as any,
      storage as any,
      audit as any,
      workspaces as any,
    );
  });

  it('rejects completion when direct object is missing', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      createdBy: 'u1',
      mode: 'direct',
      status: 'uploading',
      size: BigInt(8),
      storageKey: 'key',
      hash: null,
      hashAlgorithm: 'sha256',
      strategy: 'normal',
      chunks: [],
    });
    storage.headObject.mockResolvedValue(null);

    await expect(service.complete(actor, 's1', {})).rejects.toThrow(NotFoundException);
  });

  it('rejects duplicate completion idempotently with completed response', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      status: 'completed',
      mode: 'direct',
      workspaceId: 'w1',
      createdBy: 'u1',
      size: BigInt(8),
      storageKey: 'key',
      strategy: 'normal',
      chunks: [],
      file: { id: 'file-1', urlKey: 'abc', name: 'a.txt' },
    });

    const result = await service.complete(actor, 's1', {});

    expect(result).toMatchObject({ fileId: 'file-1', urlKey: 'abc' });
  });

  it('rejects merge when chunk state is incomplete', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      status: 'uploading',
      mode: 'multipart',
      workspaceId: 'w1',
      createdBy: 'u1',
      totalChunks: 3,
      size: BigInt(30),
      storageKey: 'key',
      providerUploadId: 'mp-1',
      strategy: 'normal',
      hashAlgorithm: 'sha256',
      chunks: [
        { chunkIndex: 1, status: 'uploaded', etag: 'e1', size: BigInt(10) },
        { chunkIndex: 2, status: 'uploaded', etag: 'e2', size: BigInt(10) },
      ],
    });

    await expect(service.complete(actor, 's1', {})).rejects.toThrow(ConflictException);
  });
});
