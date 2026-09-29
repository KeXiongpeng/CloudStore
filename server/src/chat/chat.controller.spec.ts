import type { Response } from 'express';
import { Test } from '@nestjs/testing';
import { ChatController } from './chat.controller';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { ChatService, type ChatStreamEvent } from './chat.service';

const actor = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  memberId: 'member-1',
  role: 'EDITOR' as const,
};

function createResponse(): Response & {
  write: jest.Mock;
  end: jest.Mock;
} {
  const response = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    write: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  };
  return response as unknown as Response & { write: jest.Mock; end: jest.Mock };
}

async function* events(values: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const value of values) yield value;
}

describe('ChatController', () => {
  let controller: ChatController;
  const chatService = { answerStream: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [{ provide: ChatService, useValue: chatService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(WorkspaceGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(ChatController);
  });

  it('设置 SSE headers，并按 sources/delta/done 顺序输出', async () => {
    const response = createResponse();
    chatService.answerStream.mockReturnValue(
      events([
        { type: 'sources', sources: [] },
        { type: 'delta', content: '回答' },
        { type: 'done', done: true },
      ]),
    );

    await controller.chat('workspace-1', actor, { question: '问题', limit: 5 }, response);

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/event-stream; charset=utf-8',
    );
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(response.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(response.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');

    expect(response.write.mock.calls.map(([payload]) => payload)).toEqual([
      'event: sources\ndata: {"sources":[]}\n\n',
      'event: delta\ndata: {"content":"回答"}\n\n',
      'event: done\ndata: {"done":true}\n\n',
    ]);
    expect(chatService.answerStream).toHaveBeenCalledWith(
      '问题',
      'workspace-1',
      5,
      undefined,
      'user-1',
    );
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('service 抛错时输出 error，并确保响应结束', async () => {
    const response = createResponse();
    chatService.answerStream.mockImplementation(async function* () {
      throw new Error('unexpected');
    });

    await controller.chat(
      'workspace-1',
      actor,
      { question: '问题', limit: 5, sessionId: '0ea2f07b-5ff4-465d-a9e5-45d46cd672ef' },
      response,
    );

    expect(response.write).toHaveBeenCalledWith(
      'event: error\ndata: {"message":"生成失败，请稍后重试"}\n\n',
    );
    expect(chatService.answerStream).toHaveBeenCalledWith(
      '问题',
      'workspace-1',
      5,
      '0ea2f07b-5ff4-465d-a9e5-45d46cd672ef',
      'user-1',
    );
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('事件流中已经输出 error 时不再输出 done', async () => {
    const response = createResponse();
    chatService.answerStream.mockReturnValue(
      events([{ type: 'error', message: '模型服务鉴权失败' }]),
    );

    await controller.chat('workspace-1', actor, { question: '问题', limit: 5 }, response);

    const payloads = response.write.mock.calls.map(([payload]) => payload as string);
    expect(payloads).toEqual(['event: error\ndata: {"message":"模型服务鉴权失败"}\n\n']);
    expect(payloads.some((payload) => payload.startsWith('event: done'))).toBe(false);
  });
});

describe('ChatController appended SSE compatibility', () => {
  it('forwards session and actions events without breaking sources/delta/done order', async () => {
    const service = { answerStream: jest.fn() };
    const controller = new ChatController(service as never);
    const response = createResponse();
    service.answerStream.mockReturnValue(
      events([
        { type: 'session', session: { id: 'session-1', title: '新会话' } },
        { type: 'sources', sources: [] },
        { type: 'delta', content: '引导' },
        {
          type: 'actions',
          actions: [{ id: 'files', type: 'navigate', label: '查看文件', href: '/files' }],
        },
        { type: 'done', done: true },
      ]),
    );

    await controller.chat('workspace-1', actor, { question: '问题', limit: 5 }, response);

    const payloads = response.write.mock.calls.map(([payload]) => payload as string);
    expect(payloads).toEqual([
      'event: session\ndata: {"session":{"id":"session-1","title":"新会话"}}\n\n',
      'event: sources\ndata: {"sources":[]}\n\n',
      'event: delta\ndata: {"content":"引导"}\n\n',
      'event: actions\ndata: {"actions":[{"id":"files","type":"navigate","label":"查看文件","href":"/files"}]}\n\n',
      'event: done\ndata: {"done":true}\n\n',
    ]);
  });
});
