import api from './api';

const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024;
const PART_SIZE = 2 * 1024 * 1024;

export async function uploadSmallFile(file: File): Promise<any> {
  const presignResponse = await api.post('/files/presign', {
    filename: file.name,
    contentType: file.type,
    fileSize: file.size,
  });

  const { uploadUrl, storageKey } = presignResponse.data;

  await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  const callbackResponse = await api.post('/files/callback', {
    filename: file.name,
    contentType: file.type,
    fileSize: file.size,
    storageKey,
  });

  return callbackResponse.data;
}

export async function uploadLargeFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<any> {
  const initResponse = await api.post('/files/upload-init', {
    filename: file.name,
    contentType: file.type,
    totalSize: file.size,
  });

  const { uploadId } = initResponse.data;

  const totalParts = Math.ceil(file.size / PART_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];

  for (let i = 0; i < totalParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, file.size);
    const blob = file.slice(start, end);

    const formData = new FormData();
    formData.append('file', blob);

    const partResponse = await api.post(
      `/files/upload-part?uploadId=${uploadId}&partNumber=${i + 1}`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );

    parts.push({
      partNumber: i + 1,
      etag: partResponse.data.etag,
    });

    if (onProgress) {
      const progress = Math.round(((i + 1) / totalParts) * 100);
      onProgress(progress);
    }
  }

  const completeResponse = await api.post('/files/upload-complete', {
    uploadId,
    filename: file.name,
    contentType: file.type,
    totalSize: file.size,
    parts,
  });

  return completeResponse.data;
}

export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<any> {
  if (file.size <= SMALL_FILE_THRESHOLD) {
    if (onProgress) onProgress(30);
    const result = await uploadSmallFile(file);
    if (onProgress) onProgress(100);
    return result;
  } else {
    return uploadLargeFile(file, onProgress);
  }
}
