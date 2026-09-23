export interface XHRUploadResult {
  etag: string;
}

export function putWithProgress(
  url: string,
  body: Blob,
  onProgress?: (uploadedBytes: number) => void,
): Promise<XHRUploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag') || '';
        if (!etag) {
          reject(new Error('storage did not return an ETag'));
          return;
        }
        resolve({ etag: etag.replaceAll('"', '') });
      } else {
        reject(new Error(`upload failed: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.send(body);
  });
}
