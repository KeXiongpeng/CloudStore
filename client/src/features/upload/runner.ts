import {
  completeUpload,
  confirmChunk,
  confirmInstantUpload,
  createChunkUrls,
  createDirectUrl,
  createUploadSession,
  resumeUpload,
} from './api';
import { hashFileInWorker } from './hash';
import { logUploadEvent, redactUploadUrl } from './logging';
import { useUploadQueue } from './store';
import { XHRUploadResult, putWithProgress } from './xhr';

const CHUNK_SIZE = 8 * 1024 * 1024;
const DIRECT_THRESHOLD = 8 * 1024 * 1024;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runUploadItem(id: string) {
  let phase = 'start';
  const queued = useUploadQueue.getState().items.find((entry) => entry.id === id);
  if (!queued) return;

  const { setStatus, updateProgress } = useUploadQueue.getState();

  try {
    logUploadEvent('item.start', {
      id,
      name: queued.file.name,
      size: queued.file.size,
      type: queued.file.type,
    });

    if (!queued.hash) {
      phase = 'hashing';
      setStatus(id, 'hashing');
      logUploadEvent(
        'hash.started',
        {
          id,
          name: queued.file.name,
          size: queued.file.size,
        },
        'info',
      );
      const hash = await hashFileInWorker(queued.file);
      logUploadEvent('hash.finished', { id, hash });
      setStatus(id, 'creating', { hash });
    }

    const current = useUploadQueue.getState().items.find((entry) => entry.id === id);
    if (!current) return;
    const { file, workspaceId } = current;
    const initialSessionId = current.uploadSessionId;

    phase = 'creating_session';
    setStatus(id, 'creating');

    const session = initialSessionId
      ? await resumeUpload(workspaceId, initialSessionId)
      : await createUploadSession(current);

    phase = 'session_ready';
    logUploadEvent('session.ready', {
      id,
      uploadSessionId: session.uploadSessionId,
      mode: session.mode,
      strategy: session.strategy,
      missingChunks: session.missingChunks,
    });
    setStatus(id, session.strategy === 'instant' ? 'instant' : 'uploading', {
      uploadSessionId: session.uploadSessionId,
      missingChunks: session.missingChunks,
    });

    if (session.strategy === 'instant') {
      phase = 'instant_confirm';
      const result = await confirmInstantUpload(workspaceId, session.uploadSessionId);
      logUploadEvent('instant.confirmed', {
        id,
        uploadSessionId: session.uploadSessionId,
        fileId: result.fileId,
      });
      setStatus(id, 'completed', {
        progress: 100,
        uploadedBytes: current.file.size,
        error: undefined,
      });
      return result;
    }

    if (current.file.size <= DIRECT_THRESHOLD) {
      phase = 'direct_url';
      const direct = await createDirectUrl(workspaceId, session.uploadSessionId);
      const safeDirectUrl = redactUploadUrl(direct.uploadUrl);
      logUploadEvent('direct_url.ready', {
        id,
        uploadSessionId: session.uploadSessionId,
        url: safeDirectUrl,
        expiresAt: direct.expiresAt,
      });

      phase = 'direct_put';
      await putWithProgress(direct.uploadUrl, file, (bytes) =>
        updateProgress(id, bytes, file.size),
      );

      phase = 'direct_complete';
      const result = await completeUpload(workspaceId, session.uploadSessionId, {
        hash: current.hash,
      });
      logUploadEvent('direct.completed', {
        id,
        uploadSessionId: session.uploadSessionId,
        fileId: result.fileId,
      });
      setStatus(id, 'completed', { progress: 100, uploadedBytes: file.size });
      return result;
    }

    phase = 'multipart_prepare';
    const totalChunks = Math.ceil(current.file.size / CHUNK_SIZE);
    const parts: { partNumber: number; etag: string }[] = [];
    const missing = session.missingChunks?.length
      ? session.missingChunks
      : Array.from({ length: totalChunks }, (_, index) => index + 1);

    for (const chunkIndex of missing) {
      phase = `chunk_url:${chunkIndex}`;
      const urls = await createChunkUrls(workspaceId, session.uploadSessionId, [chunkIndex]);
      logUploadEvent('chunk_url.ready', {
        id,
        uploadSessionId: session.uploadSessionId,
        chunkIndex,
        url: redactUploadUrl(urls[0]?.uploadUrl ?? ''),
      });

      const start = (chunkIndex - 1) * CHUNK_SIZE;
      const blob = current.file.slice(start, Math.min(start + CHUNK_SIZE, current.file.size));

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          phase = `chunk_put:${chunkIndex}:${attempt + 1}`;
          const result: XHRUploadResult = await putWithProgress(urls[0].uploadUrl, blob, (bytes) =>
            updateProgress(id, start + bytes, current.file.size),
          );
          logUploadEvent('chunk.uploaded', { id, chunkIndex, etag: result.etag });

          phase = `chunk_confirm:${chunkIndex}`;
          await confirmChunk(workspaceId, session.uploadSessionId, chunkIndex, result.etag);
          parts.push({ partNumber: chunkIndex, etag: result.etag });
          break;
        } catch (error) {
          logUploadEvent(
            'chunk.attempt_failed',
            {
              id,
              chunkIndex,
              attempt: attempt + 1,
              message: (error as Error)?.message,
            },
            'warn',
          );
          if (attempt === 2) throw error;
          await sleep(1000 * 2 ** attempt);
        }
      }
    }

    const stillQueued = useUploadQueue.getState().items.find((entry) => entry.id === id);
    if (!stillQueued) return;

    phase = 'multipart_complete';
    setStatus(id, 'merging');
    const result = await completeUpload(workspaceId, session.uploadSessionId, {
      hash: stillQueued.hash,
      parts,
    });
    logUploadEvent('multipart.completed', {
      id,
      uploadSessionId: session.uploadSessionId,
      fileId: result.fileId,
    });
    setStatus(id, 'completed', { progress: 100, uploadedBytes: file.size });
    return result;
  } catch (error) {
    logUploadEvent(
      'item.failed',
      {
        id,
        phase,
        name: queued.file.name,
        message: (error as Error)?.message,
      },
      'error',
    );
    const item = useUploadQueue.getState().items.find((entry) => entry.id === id);
    const axiosCode = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
    const humanMessage =
      axiosCode === 'WORKSPACE_NOT_FOUND'
        ? '当前工作区不可用，请重新选择工作区后再上传'
        : (error as Error).message;

    setStatus(id, 'failed', {
      error: humanMessage,
      attempt: (item?.attempt || 0) + 1,
    });
    throw error;
  }
}

/** 每个版本号都必须在浏览器日志中出现；用户用它确认不是旧 JS 还在运行。 */
const UPLOAD_SCHEDULER_VERSION = 'continuous-v2-2026-09-28';

function statusCounts(items: Array<{ status: string }>): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    return counts;
  }, {});
}

function describeItems(
  items: Array<{
    id: string;
    status: string;
    attempt: number;
    file: { name: string; size: number };
  }>,
) {
  return items.map((item) => ({
    id: item.id,
    name: item.file.name,
    size: item.file.size,
    status: item.status,
    attempt: item.attempt,
  }));
}

export async function runQueuedUploads() {
  let round = 0;
  const initialState = useUploadQueue.getState();

  logUploadEvent(
    'queue.scheduler.enter',
    {
      schedulerVersion: UPLOAD_SCHEDULER_VERSION,
      maxActiveFiles: initialState.maxActiveFiles,
      statusCounts: statusCounts(initialState.items),
    },
    'info',
  );

  while (true) {
    round += 1;
    const state = useUploadQueue.getState();
    const hashing = state.items.filter((item) => item.status === 'hashing');
    const runnable = hashing.slice(0, state.maxActiveFiles);

    logUploadEvent(
      'queue.round.pick',
      {
        round,
        schedulerVersion: UPLOAD_SCHEDULER_VERSION,
        maxActiveFiles: state.maxActiveFiles,
        hashingCount: hashing.length,
        pickedCount: runnable.length,
        statusCounts: statusCounts(state.items),
        picked: describeItems(runnable).slice(0, 30),
      },
      'info',
    );

    if (runnable.length === 0) {
      logUploadEvent(
        'queue.scheduler.exit',
        {
          round,
          schedulerVersion: UPLOAD_SCHEDULER_VERSION,
          reason: 'no_hashing_items',
        },
        'info',
      );
      return;
    }

    const startedAt = Date.now();
    logUploadEvent(
      'queue.batch.start',
      {
        round,
        schedulerVersion: UPLOAD_SCHEDULER_VERSION,
        items: describeItems(runnable),
      },
      'info',
    );

    const results = await Promise.allSettled(runnable.map((item) => runUploadItem(item.id)));

    const afterState = useUploadQueue.getState();
    logUploadEvent(
      'queue.batch.finished',
      {
        round,
        schedulerVersion: UPLOAD_SCHEDULER_VERSION,
        durationMs: Date.now() - startedAt,
        statusCounts: statusCounts(afterState.items),
        results: results.map((result, resultIndex) => ({
          id: runnable[resultIndex]?.id,
          name: runnable[resultIndex]?.file.name,
          result: result.status === 'fulfilled' ? 'fulfilled' : 'rejected',
          message:
            result.status === 'rejected'
              ? String(result.reason?.message ?? result.reason)
              : undefined,
        })),
      },
      'info',
    );
  }
}
