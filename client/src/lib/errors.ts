import { isAxiosError } from 'axios';

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    const message = data?.message;

    if (Array.isArray(message)) return message[0] ?? fallback;
    if (typeof message === 'string' && message) return message;
    if (error.message) return error.message;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
