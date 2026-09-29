import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runQueuedUploads } from './runner';
import { useUploadQueue } from './store';
import { confirmInstantUpload, createUploadSession } from './api';

vi.mock('./api', () => ({
  completeUpload: vi.fn(),
  confirmChunk: vi.fn(),
  confirmInstantUpload: vi.fn(),
  createChunkUrls: vi.fn(),
  createDirectUrl: vi.fn(),
  createUploadSession: vi.fn(),
  resumeUpload: vi.fn(),
}));

vi.mock('./hash', () => ({
  hashFileInWorker: vi.fn().mockResolvedValue('hash'),
}));

vi.mock('./xhr', () => ({
  putWithProgress: vi.fn(),
}));

const mockedCreateUploadSession = vi.mocked(createUploadSession);
const mockedConfirmInstantUpload = vi.mocked(confirmInstantUpload);

describe('upload runner scheduling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUploadQueue.setState({ items: [], activeCount: 0, maxActiveFiles: 3 });
    mockedConfirmInstantUpload.mockResolvedValue({ fileId: 'file-1' });
    mockedCreateUploadSession.mockImplementation(async (item) => ({
      uploadSessionId: `session-${item.file.name}`,
      mode: 'direct' as const,
      strategy: 'instant' as const,
      chunkSize: 8 * 1024 * 1024,
      totalChunks: 1,
      uploadedChunks: [],
      expiresAt: new Date().toISOString(),
    }));
  });

  it('第一批完成后继续调度剩余队列，而不是停在 maxActiveFiles', async () => {
    const files = Array.from({ length: 5 }, (_, index) => {
      return new File([`content-${index + 1}`], `file-${index + 1}.txt`, {
        type: 'text/plain',
      });
    });
    useUploadQueue.getState().enqueueFiles(files, 'workspace-1');

    await runQueuedUploads();

    const states = useUploadQueue
      .getState()
      .items.map((item) => ({ name: item.file.name, status: item.status }));

    expect(mockedCreateUploadSession).toHaveBeenCalledTimes(5);
    expect(states.filter((item) => item.status === 'completed')).toHaveLength(5);
    expect(states.filter((item) => item.status === 'hashing')).toHaveLength(0);
  });
});
