import { readFileSync } from 'fs';
import { join } from 'path';

describe('Prisma schema deployment targets', () => {
  it('generates a client for the Alpine worker runtime', () => {
    const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
    expect(schema).toContain('binaryTargets = ["native", "linux-musl-openssl-3.0.x"]');
  });
});
