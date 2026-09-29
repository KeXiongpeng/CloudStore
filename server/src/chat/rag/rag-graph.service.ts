import { Injectable } from '@nestjs/common';
import { DocumentsService } from '../../documents/documents.service';
import { LlmService } from '../llm.service';
import { AsyncEventQueue } from './async-event-queue';
import { createRagGraph } from './rag-graph.factory';
import { type RagGraphState } from './rag-state';

/**
 * RagGraphService 只负责“启动图并把节点事件排空”。
 * 它不知道 Express Response，也不知道 SSE header 格式；Controller 仍然负责协议。
 */
@Injectable()
export class RagGraphService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly llmService: LlmService,
  ) {}

  /**
   * invoke 完成后 close 队列；未捕获异常 fail 队列。
   * ChatService 的 for-await 因此一定会在 error/done 之后结束，不会悬挂。
   */
  async run(
    initialState: RagGraphState,
    queue: AsyncEventQueue<import('../chat.service').ChatStreamEvent>,
  ): Promise<RagGraphState | undefined> {
    const graph = createRagGraph({
      documentsService: this.documentsService,
      llmService: this.llmService,
      onEvent: (event) => queue.push(event),
    });

    let finalState: RagGraphState;
    try {
      finalState = await graph.invoke(initialState);
    } catch (error) {
      queue.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    // 必须先 close，再返回；否则 return 会跳过 close，消费者会在 done 后继续等待。
    queue.close();
    return finalState;
  }
}
