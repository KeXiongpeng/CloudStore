import { Body, Controller, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { AskQuestionDto } from './dto/ask-question.dto';
import { ChatService, type ChatStreamEvent } from './chat.service';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspaces/:workspaceId/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermission('file:view')
  @ApiOperation({ summary: '基于当前工作区知识库流式回答问题' })
  @ApiOkResponse({ description: 'SSE: sources / delta / done / error' })
  async chat(
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AskQuestionDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');

    let hasError = false;
    try {
      for await (const event of this.chatService.answerStream(
        dto.question,
        workspaceId,
        dto.limit ?? 5,
      )) {
        if (event.type === 'error') hasError = true;
        this.writeEvent(response, event);
      }
    } catch {
      if (!hasError) {
        this.writeEvent(response, { type: 'error', message: '生成失败，请稍后重试' });
      }
    } finally {
      response.end();
    }
  }

  private writeEvent(response: Response, event: ChatStreamEvent): void {
    const { type, ...data } = event;
    response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
