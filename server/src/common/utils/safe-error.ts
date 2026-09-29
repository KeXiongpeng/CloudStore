/**
 * 把未知错误收敛成可安全写入日志的摘要。
 * 禁止直接把 Axios Error 交给 Logger：它的 inspect 输出可能带 config.headers.Authorization、
 * API key、完整请求体和上游响应体。
 */
export interface SafeErrorSummary {
  name?: string;
  message: string;
  code?: string;
  status?: number;
}

/** 最后兜底脱敏：即使 message 带了 token/key，也不把完整凭据写进日志。 */
function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"',}]+/gi, '$1<redacted>')
    .replace(/\b(sk-)[A-Za-z0-9_-]{8,}/gi, '$1<redacted>')
    .slice(0, 500);
}

export function formatSafeError(error: unknown): string {
  const candidate = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };

  const summary: SafeErrorSummary = {
    name: typeof candidate?.name === 'string' ? candidate.name : undefined,
    message: redactSecrets(
      typeof candidate?.message === 'string' ? candidate.message : String(error),
    ),
    code: typeof candidate?.code === 'string' ? candidate.code : undefined,
    status: typeof candidate?.response?.status === 'number' ? candidate.response.status : undefined,
  };

  return JSON.stringify(summary);
}
