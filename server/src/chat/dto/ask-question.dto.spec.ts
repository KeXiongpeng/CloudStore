import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AskQuestionDto } from './ask-question.dto';

async function validateDto(input: Record<string, unknown>) {
  const dto = plainToInstance(AskQuestionDto, input);
  return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('AskQuestionDto', () => {
  it('接受问题并给 limit 默认值', async () => {
    const dto = plainToInstance(AskQuestionDto, { question: 'pgvector 为什么用余弦距离？' });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.question).toBe('pgvector 为什么用余弦距离？');
    expect(dto.limit).toBe(5);
  });

  it('拒绝空问题和超长问题', async () => {
    const emptyErrors = await validateDto({ question: '', limit: 5 });
    const longErrors = await validateDto({ question: '问'.repeat(1001), limit: 5 });

    expect(emptyErrors.some((error) => error.property === 'question')).toBe(true);
    expect(longErrors.some((error) => error.property === 'question')).toBe(true);
  });

  it('限制 limit 在 1 到 10 之间且必须是整数', async () => {
    const lowErrors = await validateDto({ question: '问题', limit: 0 });
    const highErrors = await validateDto({ question: '问题', limit: 11 });
    const decimalErrors = await validateDto({ question: '问题', limit: 2.5 });

    expect(lowErrors.some((error) => error.property === 'limit')).toBe(true);
    expect(highErrors.some((error) => error.property === 'limit')).toBe(true);
    expect(decimalErrors.some((error) => error.property === 'limit')).toBe(true);
  });

  it('拒绝白名单以外的字段', async () => {
    const errors = await validateDto({ question: '问题', limit: 3, prompt: 'hack' });

    expect(errors.some((error) => error.property === 'prompt')).toBe(true);
  });
});
describe('AskQuestionDto D7 session', () => {
  it('accepts an optional server sessionId and keeps existing payload compatible', async () => {
    const dto = plainToInstance(AskQuestionDto, {
      question: '有多少问题',
      sessionId: '0ea2f07b-5ff4-465d-a9e5-45d46cd672ef',
      limit: 5,
    });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.sessionId).toBe('0ea2f07b-5ff4-465d-a9e5-45d46cd672ef');
  });

  it('rejects a malformed sessionId', async () => {
    const dto = plainToInstance(AskQuestionDto, { question: '问题', sessionId: '../../session' });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'sessionId')).toBe(true);
  });
});
