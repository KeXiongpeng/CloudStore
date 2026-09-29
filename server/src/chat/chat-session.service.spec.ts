import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ChatSessionService } from './chat-session.service';

const actor = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  memberId: 'member-1',
  role: 'EDITOR' as const,
};

function createService() {
  const prisma = {
    chatSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    chatMessage: {
      createMany: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
  return { service: new ChatSessionService(prisma as never), prisma };
}

describe('ChatSessionService', () => {
  it('creates a new server-owned session when sessionId is omitted', async () => {
    const { service, prisma } = createService();
    prisma.chatSession.create.mockResolvedValue({ id: 'session-1', title: '新会话' });

    await expect(service.resolveForAsk(actor, undefined, '有多少问题')).resolves.toEqual({
      id: 'session-1',
      title: '新会话',
    });
    expect(prisma.chatSession.create).toHaveBeenCalledWith({
      data: { workspaceId: 'workspace-1', userId: 'user-1', title: '有多少问题' },
      select: { id: true, title: true },
    });
  });

  it('loads only a session owned by the same workspace and user', async () => {
    const { service, prisma } = createService();
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 'session-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      title: 'SEO',
    });

    await expect(service.resolveForAsk(actor, 'session-1', '有多少问题')).resolves.toEqual({
      id: 'session-1',
      title: 'SEO',
    });
  });

  it('rejects a session from another workspace', async () => {
    const { service, prisma } = createService();
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 'session-1',
      workspaceId: 'workspace-2',
      userId: 'user-1',
      title: 'SEO',
    });

    await expect(service.resolveForAsk(actor, 'session-1', '问题')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects a session from another user', async () => {
    const { service, prisma } = createService();
    prisma.chatSession.findUnique.mockResolvedValue({
      id: 'session-1',
      workspaceId: 'workspace-1',
      userId: 'user-2',
      title: 'SEO',
    });

    await expect(service.resolveForAsk(actor, 'session-1', '问题')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('loads bounded plain-text history only', async () => {
    const { service, prisma } = createService();
    prisma.chatMessage.findMany.mockResolvedValue([
      { role: 'assistant', content: '评分 42' },
      { role: 'user', content: 'SEO 数据怎么样' },
    ]);

    await expect(service.getHistory('session-1', 8)).resolves.toEqual([
      { role: 'user', content: 'SEO 数据怎么样' },
      { role: 'assistant', content: '评分 42' },
    ]);
    expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
      where: { sessionId: 'session-1', role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { role: true, content: true },
    });
  });

  it('persists user and assistant messages with serialized sources', async () => {
    const { service, prisma } = createService();
    prisma.chatMessage.createMany.mockResolvedValue({ count: 1 });
    prisma.chatMessage.create.mockResolvedValue({ id: 'message-2' });

    await service.saveUserMessage('session-1', '问题');
    await service.saveAssistantMessage('session-1', '回答', [{ title: 'SEO' }]);

    expect(prisma.chatMessage.createMany).toHaveBeenCalledWith({
      data: [{ sessionId: 'session-1', role: 'user', content: '问题' }],
    });
    expect(prisma.chatMessage.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'session-1',
        role: 'assistant',
        content: '回答',
        sources: [{ title: 'SEO' }],
      },
    });
  });
});
