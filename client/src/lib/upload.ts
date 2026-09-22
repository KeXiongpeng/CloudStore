import api from './api';

const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024;
const PART_SIZE = 2 * 1024 * 1024;

function uploadWithProgress(
  url: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`上传失败: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.send(file);
  });
}

export interface UploadedFile {
  id: string;
  originalName: string;
  urlKey: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}
export async function uploadSmallFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<UploadedFile> {
  const presignResponse = await api.post('/files/presign', {
    filename: file.name,
    contentType: file.type,
    fileSize: file.size,
  });

  const { uploadUrl, storageKey } = presignResponse.data;

  if (onProgress) onProgress(10);

  await uploadWithProgress(uploadUrl, file, (p) => {
    if (onProgress) onProgress(10 + Math.round(p * 0.85));
  });

  if (onProgress) onProgress(95);

  const callbackResponse = await api.post('/files/callback', {
    filename: file.name,
    contentType: file.type,
    fileSize: file.size,
    storageKey,
  });

  if (onProgress) onProgress(100);
  return callbackResponse.data;
}

export async function uploadLargeFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<UploadedFile> {
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
      const progress = Math.round(((i + 1) / totalParts) * 95);
      onProgress(progress);
    }
  }

  if (onProgress) onProgress(98);

  const completeResponse = await api.post('/files/upload-complete', {
    uploadId,
    filename: file.name,
    contentType: file.type,
    totalSize: file.size,
    parts,
  });

  if (onProgress) onProgress(100);
  return completeResponse.data;
}

export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<UploadedFile> {
  if (file.size <= SMALL_FILE_THRESHOLD) {
    return uploadSmallFile(file, onProgress);
  } else {
    return uploadLargeFile(file, onProgress);
  }
}
