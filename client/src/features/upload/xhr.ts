import { logUploadEvent, redactUploadUrl } from './logging';

export interface XHRUploadResult {
  etag: string;
}

/**
 * 通过 XHR 直传对象存储。
 * axios 不方便暴露 upload progress；这里保留 XHR 以显示每个字节的上传进度。
 */
export function putWithProgress(
  url: string,
  body: Blob,
  onProgress?: (uploadedBytes: number) => void,
): Promise<XHRUploadResult> {
  return new Promise((resolve, reject) => {
    const safeUrl = redactUploadUrl(url);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);

    logUploadEvent('put.start', { url: safeUrl, bytes: body.size, type: body.type });

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag') || '';
        if (!etag) {
          logUploadEvent('put.missing_etag', { url: safeUrl, status: xhr.status }, 'error');
          reject(new Error('storage did not return an ETag'));
          return;
        }

        logUploadEvent('put.success', { url: safeUrl, status: xhr.status });
        resolve({ etag: etag.replaceAll('"', '') });
        return;
      }

      logUploadEvent(
        'put.http_error',
        { url: safeUrl, status: xhr.status, response: xhr.responseText?.slice(0, 500) },
        'warn',
      );
      reject(new Error(`upload failed: ${xhr.status}`));
    };

    // status=0 通常意味着服务不可达、DNS/端口错误、断网，或 CORS 预检/响应头被拦截。
    xhr.onerror = () => {
      logUploadEvent(
        'put.network_error',
        {
          url: safeUrl,
          readyState: xhr.readyState,
          status: xhr.status,
          hint: '对象存储不可达、端口未启动、断网或 CORS 失败',
        },
        'error',
      );
      reject(new Error('无法连接对象存储；请确认 MinIO/存储服务已启动'));
    };

    xhr.onabort = () => {
      logUploadEvent('put.aborted', { url: safeUrl }, 'warn');
      reject(new Error('upload aborted'));
    };

    xhr.ontimeout = () => {
      logUploadEvent('put.timeout', { url: safeUrl }, 'error');
      reject(new Error('upload timeout'));
    };

    xhr.send(body);
  });
}
