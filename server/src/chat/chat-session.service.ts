import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActorContext } from '../workspaces/types';
import { type ChatHistoryMessage } from './llm.service';

export type ChatSessionMetadata = { id: string; title: string };

export type PersistedChatSource = Record<string, unknown>;

@Injectable()
export class ChatSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** sessionId 是所有权边界，而不是给模型看的上下文；跨 workspace/user 一律按不存在处理。 */
  async resolveForAsk(
    actor: WorkspaceActorContext,
    sessionId: string | undefined,
    question: string,
  ): Promise<ChatSessionMetadata> {
    if (!sessionId?.trim()) {
      const title = question.trim().slice(0, 40) || '新会话';
      return this.prisma.chatSession.create({
        data: { workspaceId: actor.workspaceId, userId: actor.userId, title },
        select: { id: true, title: true },
      });
    }

    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, title: true, workspaceId: true, userId: true },
    });
    if (!session || session.workspaceId !== actor.workspaceId || session.userId !== actor.userId) {
      throw new NotFoundException('聊天会话不存在');
    }
    return { id: session.id, title: session.title };
  }

  async getHistory(sessionId: string, limit = 10): Promise<ChatHistoryMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { sessionId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(20, Math.max(1, limit)),
      select: { role: true, content: true },
    });
    return rows.reverse().map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.content.slice(0, 2000),
    }));
  }

  async saveUserMessage(sessionId: string, content: string): Promise<void> {
    await this.prisma.chatMessage.createMany({
      data: [{ sessionId, role: 'user', content }],
    });
  }

  async saveAssistantMessage(
    sessionId: string,
    content: string,
    sources: PersistedChatSource[],
  ): Promise<void> {
    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content,
        sources: sources as Prisma.InputJsonValue,
      },
    });
  }
}
