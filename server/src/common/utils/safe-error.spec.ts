import { formatSafeError } from './safe-error';

describe('formatSafeError', () => {
  it('只输出错误摘要，不输出 Axios config、响应体或 Authorization/key', () => {
    const error = Object.assign(new Error('connect EACCES 1.2.3.4:443'), {
      code: 'EACCES',
      response: { status: 401, data: { secret: 'response-secret' } },
      config: {
        headers: {
          Authorization: 'Bearer sk-test-secret-key-1234567890',
        },
      },
    });

    const formatted = formatSafeError(error);

    expect(formatted).not.toContain('sk-test-secret-key-1234567890');
    expect(formatted).not.toContain('response-secret');
    expect(formatted).toContain('connect EACCES');
    expect(JSON.parse(formatted)).toMatchObject({
      name: 'Error',
      message: 'connect EACCES 1.2.3.4:443',
      code: 'EACCES',
      status: 401,
    });
  });

  it('处理普通值并截断过长消息', () => {
    const formatted = formatSafeError('x'.repeat(1000));

    expect(formatted.length).toBeLessThan(600);
    expect(JSON.parse(formatted).message).toHaveLength(500);
  });
});
