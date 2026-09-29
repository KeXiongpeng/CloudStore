import { afterEach, describe, expect, it, vi } from 'vitest';
import { logUploadEvent, redactUploadUrl } from './logging';

describe('redactUploadUrl', () => {
  it('保留来源和路径，但移除预签名查询参数', () => {
    const url =
      'https://minio.example:9000/bucket/workspace/2026/09/file?X-Amz-Signature=secret&X-Amz-Expires=900';
    expect(redactUploadUrl(url)).toBe(
      'https://minio.example:9000/bucket/workspace/2026/09/file?redacted',
    );
  });

  it('非法 URL 返回占位符，不抛出异常', () => {
    expect(redactUploadUrl('not-a-url')).toBe('<invalid-upload-url>');
  });
});

describe('logUploadEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('info 级别输出到 console.info，方便默认 DevTools 过滤器看到调度日志', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    logUploadEvent('queue.debug-check', { round: 1 }, 'info');

    expect(info).toHaveBeenCalledTimes(1);
    const payload = info.mock.calls[0]?.[1] as { phase: string; round: number };
    expect(payload.phase).toBe('queue.debug-check');
    expect(payload.round).toBe(1);
  });
});
