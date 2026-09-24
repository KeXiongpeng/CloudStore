import { ConflictException } from '@nestjs/common';
import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { findFirst: jest.fn(), update: jest.fn() },
  uploadChunk: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(async (fn: any) =>
    fn({
      uploadChunk: prisma.uploadChunk,
      uploadSession: prisma.uploadSession,
    }),
  ),
};
const quota = { confirm: jest.fn(), release: jest.fn() };
const storage = { createPartPutUrl: jest.fn() };
const audit = { record: jest.fn() };
const workspaces = { requireMembership: jest.fn() };

describe('UploadService chunk confirmation', () => {
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

  it('is idempotent for the same etag', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      createdBy: 'u1',
      status: 'uploading',
      uploadedChunks: 1,
      totalChunks: 1,
    });
    prisma.uploadChunk.findUnique.mockResolvedValue({
      chunkIndex: 1,
      status: 'uploaded',
      etag: 'same',
      size: BigInt(8),
    });

    const result = await service.confirmChunk(actor, 's1', 1, 'same');

    expect(result).toMatchObject({ chunkIndex: 1 });
    expect(prisma.uploadChunk.update).not.toHaveBeenCalled();
  });

  it('rejects invalid chunk index', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 's1',
      workspaceId: 'w1',
      createdBy: 'u1',
      status: 'uploading',
      totalChunks: 1,
    });
    prisma.uploadChunk.findUnique.mockResolvedValue(null);

    await expect(service.confirmChunk(actor, 's1', 2, 'etag')).rejects.toThrow(ConflictException);
  });
});
