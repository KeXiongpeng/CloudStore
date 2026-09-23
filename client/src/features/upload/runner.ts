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
import { useUploadQueue } from './store';
import { XHRUploadResult, putWithProgress } from './xhr';

const CHUNK_SIZE = 8 * 1024 * 1024;
const DIRECT_THRESHOLD = 8 * 1024 * 1024;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runUploadItem(id: string) {
  const queued = useUploadQueue.getState().items.find((entry) => entry.id === id);
  if (!queued) return;

  const { setStatus, updateProgress } = useUploadQueue.getState();

  try {
    if (!queued.hash) {
      setStatus(id, 'hashing');
      console.debug('[upload] hashing started', {
        id,
        name: queued.file.name,
        size: queued.file.size,
      });
      const hash = await hashFileInWorker(queued.file);
      console.debug('[upload] hashing finished', { id, hash });
      setStatus(id, 'creating', { hash });
    }

    const current = useUploadQueue.getState().items.find((entry) => entry.id === id);
    if (!current) return;
    const { file, workspaceId } = current;
    const initialSessionId = current.uploadSessionId;

    setStatus(id, 'creating');

    const session = initialSessionId
      ? await resumeUpload(workspaceId, initialSessionId)
      : await createUploadSession(current);
    console.debug('[upload] session ready', { id, session });

    setStatus(id, session.strategy === 'instant' ? 'instant' : 'uploading', {
      uploadSessionId: session.uploadSessionId,
      missingChunks: session.missingChunks,
    });

    if (session.strategy === 'instant') {
      const result = await confirmInstantUpload(workspaceId, session.uploadSessionId);
      setStatus(id, 'completed', {
        progress: 100,
        uploadedBytes: current.file.size,
        error: undefined,
      });
      return result;
    }

    if (current.file.size <= DIRECT_THRESHOLD) {
      const direct = await createDirectUrl(workspaceId, session.uploadSessionId);
      console.debug('[upload] direct URL ready', { id, uploadSessionId: session.uploadSessionId });
      await putWithProgress(direct.uploadUrl, file, (bytes) =>
        updateProgress(id, bytes, file.size),
      );
      const result = await completeUpload(workspaceId, session.uploadSessionId, {
        hash: current.hash,
      });
      setStatus(id, 'completed', { progress: 100, uploadedBytes: current.file.size });
      return result;
    }

    const totalChunks = Math.ceil(current.file.size / CHUNK_SIZE);
    const parts: { partNumber: number; etag: string }[] = [];
    const missing = session.missingChunks?.length
      ? session.missingChunks
      : Array.from({ length: totalChunks }, (_, index) => index + 1);

    for (const chunkIndex of missing) {
      const urls = await createChunkUrls(workspaceId, session.uploadSessionId, [chunkIndex]);
      console.debug('[upload] chunk URL ready', { id, chunkIndex });
      const start = (chunkIndex - 1) * CHUNK_SIZE;
      const blob = current.file.slice(start, Math.min(start + CHUNK_SIZE, current.file.size));

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result: XHRUploadResult = await putWithProgress(urls[0].uploadUrl, blob, (bytes) =>
            updateProgress(id, start + bytes, current.file.size),
          );
          console.debug('[upload] chunk uploaded', { id, chunkIndex, etag: result.etag });
          await confirmChunk(workspaceId, session.uploadSessionId, chunkIndex, result.etag);
          parts.push({ partNumber: chunkIndex, etag: result.etag });
          break;
        } catch (error) {
          if (attempt === 2) throw error;
          await sleep(1000 * 2 ** attempt);
        }
      }
    }

    const stillQueued = useUploadQueue.getState().items.find((entry) => entry.id === id);
    if (!stillQueued) return;

    setStatus(id, 'merging');
    const result = await completeUpload(workspaceId, session.uploadSessionId, {
      hash: stillQueued.hash,
      parts,
    });
    setStatus(id, 'completed', { progress: 100, uploadedBytes: file.size });
    return result;
  } catch (error) {
    console.error('[upload] failed', {
      id,
      error,
      message: (error as Error)?.message,
      axiosCode: (error as { response?: { data?: { code?: string } } })?.response?.data?.code,
      axiosMessage: (error as { response?: { data?: { message?: unknown } } })?.response?.data
        ?.message,
      requestId: (error as { response?: { data?: { requestId?: string } } })?.response?.data
        ?.requestId,
    });
    const item = useUploadQueue.getState().items.find((entry) => entry.id === id);
    const axiosCode = (error as { response?: { data?: { code?: string } } })?.response?.data?.code;
    const humanMessage =
      axiosCode === 'WORKSPACE_NOT_FOUND' ? '?????????????????????' : (error as Error).message;

    setStatus(id, 'failed', {
      error: humanMessage,
      attempt: (item?.attempt || 0) + 1,
    });
    throw error;
  }
}

export async function runQueuedUploads() {
  const runnable = useUploadQueue
    .getState()
    .items.filter((item) => item.status === 'hashing')
    .slice(0, useUploadQueue.getState().maxActiveFiles);

  await Promise.all(runnable.map((item) => runUploadItem(item.id).catch(() => undefined)));
}
