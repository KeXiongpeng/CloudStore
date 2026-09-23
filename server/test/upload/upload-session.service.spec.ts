import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UploadService } from '../../src/upload/upload.service';

const prisma: any = {
  uploadSession: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  storageObject: { findUnique: jest.fn() },
  uploadChunk: { createMany: jest.fn(), findMany: jest.fn() },
  file: { create: jest.fn() },
  fileVersion: { create: jest.fn() },
  $transaction: jest.fn(),
};
const quota = { reserve: jest.fn(), confirm: jest.fn(), release: jest.fn() };
const storage = { createMultipart: jest.fn() };
const audit = { record: jest.fn() };
const workspaces = { requireMembership: jest.fn() };

describe('UploadService session creation', () => {
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

  it('creates instant strategy when hash and size match an available object', async () => {
    prisma.storageObject.findUnique.mockResolvedValue({
      id: 'object-1',
      hash: 'a'.repeat(64),
      size: BigInt(8),
      status: 'available',
      storageKey: 'objects/a',
    });
    prisma.uploadSession.create.mockResolvedValue({
      id: 'session-1',
      clientUploadId: 'client-1',
      mode: 'direct',
      strategy: 'instant',
      chunkSize: 8388608,
      totalChunks: 1,
      uploadedChunks: 0,
      expiresAt: new Date(),
    });

    const result = await service.createSession(actor, {
      filename: 'a.txt',
      mimeType: 'text/plain',
      size: 8,
      hash: 'a'.repeat(64),
    });

    expect(result.strategy).toBe('instant');
    expect(quota.reserve).toHaveBeenCalledWith({ workspaceId: 'w1', size: BigInt(8) });
  });

  it('rejects an invalid folder', async () => {
    prisma.storageObject.findUnique.mockResolvedValue(null);
    prisma.uploadSession.create.mockRejectedValue(new Error('foreign key'));

    await expect(
      service.createSession(actor, {
        filename: 'a.txt',
        mimeType: 'text/plain',
        size: 8,
        folderId: 'missing',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('returns missing chunks for a resumable multipart session', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue({
      id: 'session-2',
      createdBy: 'u1',
      status: 'uploading',
      strategy: 'normal',
      mode: 'multipart',
      chunkSize: 8388608,
      totalChunks: 3,
      expiresAt: new Date(),
      chunks: [
        { chunkIndex: 1, status: 'uploaded' },
        { chunkIndex: 2, status: 'pending' },
        { chunkIndex: 3, status: 'pending' },
      ],
    });

    const result = await service.getResume(actor, 'session-2');

    expect(result.uploadedChunks).toEqual([1]);
    expect(result.missingChunks).toEqual([2, 3]);
  });

  it('throws not found for another workspace', async () => {
    prisma.uploadSession.findFirst.mockResolvedValue(null);

    await expect(service.getResume(actor, 'missing')).rejects.toThrow(NotFoundException);
  });
});
