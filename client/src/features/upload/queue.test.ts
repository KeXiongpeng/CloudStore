import { beforeEach, describe, expect, it } from 'vitest';
import { useUploadQueue } from './store';

describe('upload queue store', () => {
  beforeEach(() => {
    useUploadQueue.setState({ items: [] });
  });

  it('enqueues files with workspace context', () => {
    useUploadQueue
      .getState()
      .enqueueFiles([new File(['a'], 'a.txt', { type: 'text/plain' })], 'workspace-1');

    const item = useUploadQueue.getState().items[0];
    expect(item.workspaceId).toBe('workspace-1');
    expect(item.status).toBe('hashing');
  });

  it('clears only completed and canceled items', () => {
    useUploadQueue.setState({
      items: [
        {
          id: '1',
          file: new File(['a'], 'a'),
          workspaceId: 'w',
          status: 'completed',
          progress: 100,
          uploadedBytes: 1,
          attempt: 0,
        },
        {
          id: '2',
          file: new File(['a'], 'a'),
          workspaceId: 'w',
          status: 'failed',
          progress: 10,
          uploadedBytes: 1,
          attempt: 1,
        },
      ],
    });

    useUploadQueue.getState().clearCompleted();
    expect(useUploadQueue.getState().items.map((item) => item.id)).toEqual(['2']);
  });
});
