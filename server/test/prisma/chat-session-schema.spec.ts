import { readFileSync } from 'fs';
import { join } from 'path';

describe('D7 Prisma chat session schema', () => {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

  it('defines server-owned chat sessions and messages with ownership indexes', () => {
    expect(schema).toContain('model ChatSession');
    expect(schema).toContain('model ChatMessage');
    expect(schema).toContain('@@index([workspaceId, userId, updatedAt])');
    expect(schema).toContain('@@index([sessionId, createdAt])');
    expect(schema).toContain('@@map("chat_sessions")');
    expect(schema).toContain('@@map("chat_messages")');
  });

  it('cascades messages when a session is removed', () => {
    const messageModel = schema.slice(schema.indexOf('model ChatMessage'));
    expect(messageModel).toContain('onDelete: Cascade');
  });
});
