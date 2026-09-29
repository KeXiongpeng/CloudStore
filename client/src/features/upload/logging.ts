/** 上传 URL 会带签名；日志只保留 origin + path，避免泄露凭据。 */
export function redactUploadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}?redacted`;
  } catch {
    return '<invalid-upload-url>';
  }
}

export function logUploadEvent(
  phase: string,
  detail: Record<string, unknown> = {},
  level: 'debug' | 'info' | 'warn' | 'error' = 'debug',
): void {
  const payload = {
    phase,
    at: new Date().toISOString(),
    ...detail,
  };

  if (level === 'error') {
    console.error('[upload]', payload);
    return;
  }
  if (level === 'info') {
    console.info('[upload]', payload);
    return;
  }
  if (level === 'warn') {
    console.warn('[upload]', payload);
    return;
  }
  console.debug('[upload]', payload);
}
