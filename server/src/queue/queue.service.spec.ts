jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ disconnect: jest.fn() })),
}));

jest.mock('bullmq', () => ({
  __esModule: true,
  Queue: jest.fn(),
}));

import { Queue } from 'bullmq';
import { QueueService } from './queue.service';

const mockedQueueConstructor = jest.mocked(Queue);

describe('QueueService document index retry', () => {
  let queue: {
    getJob: jest.Mock;
    add: jest.Mock;
    close: jest.Mock;
  };
  let service: QueueService;

  beforeEach(() => {
    queue = {
      getJob: jest.fn(),
      add: jest.fn().mockResolvedValue({ id: 'new-job' }),
      close: jest.fn().mockResolvedValue(undefined),
    };
    mockedQueueConstructor.mockReset();
    mockedQueueConstructor.mockImplementation(() => queue as never);
    service = new QueueService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('重索引前移除 failed job，让同一个 fileVersionId 可以重新执行', async () => {
    const failedJob = {
      isFailed: jest.fn().mockResolvedValue(true),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    queue.getJob.mockResolvedValue(failedJob);

    await service.addDocumentIndexJob({
      fileId: 'file-1',
      fileVersionId: 'version-1',
      workspaceId: 'workspace-1',
    });

    expect(queue.getJob).toHaveBeenCalledWith('document-index-version-1');
    expect(failedJob.remove).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'index',
      { fileId: 'file-1', fileVersionId: 'version-1', workspaceId: 'workspace-1' },
      { jobId: 'document-index-version-1' },
    );
  });

  it('active/waiting/delayed job 仍保持去重，不重复入队', async () => {
    const activeJob = {
      isFailed: jest.fn().mockResolvedValue(false),
      remove: jest.fn(),
    };
    queue.getJob.mockResolvedValue(activeJob);

    await service.addDocumentIndexJob({
      fileId: 'file-2',
      fileVersionId: 'version-2',
      workspaceId: 'workspace-2',
    });

    expect(activeJob.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(
      'index',
      { fileId: 'file-2', fileVersionId: 'version-2', workspaceId: 'workspace-2' },
      { jobId: 'document-index-version-2' },
    );
  });
});
