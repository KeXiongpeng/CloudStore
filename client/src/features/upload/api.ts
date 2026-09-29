import api from '@/lib/api';
import { UploadItem } from './types';

export async function createUploadSession(item: UploadItem) {
  const response = await api.post(`/workspaces/${item.workspaceId}/upload/sessions`, {
    filename: item.file.name,
    mimeType: item.file.type || 'application/octet-stream',
    size: item.file.size,
    hash: item.hash,
    hashAlgorithm: 'sha256',
    folderId: item.folderId,
    clientUploadId: item.id,
  });
  return response.data;
}

export async function createDirectUrl(workspaceId: string, uploadSessionId: string) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/direct-url`,
  );
  return response.data;
}

export async function createChunkUrls(
  workspaceId: string,
  uploadSessionId: string,
  chunkIndexes: number[],
) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/chunk-urls`,
    { chunkIndexes },
  );
  return response.data;
}

export async function confirmChunk(
  workspaceId: string,
  uploadSessionId: string,
  chunkIndex: number,
  etag: string,
) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/chunks/${chunkIndex}/complete`,
    { etag },
  );
  return response.data;
}

export async function completeUpload(
  workspaceId: string,
  uploadSessionId: string,
  payload: {
    hash?: string;
    parts?: { partNumber: number; etag: string }[];
  } = {},
) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/complete`,
    payload,
  );
  return response.data;
}

export async function confirmInstantUpload(workspaceId: string, uploadSessionId: string) {
  const response = await api.post(
    `/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}/instant`,
  );
  return response.data;
}

export async function resumeUpload(workspaceId: string, uploadSessionId: string) {
  const response = await api.get(`/workspaces/${workspaceId}/upload/sessions/${uploadSessionId}`);
  return response.data;
}
