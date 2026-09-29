import { Injectable } from '@nestjs/common';
import { Inject, Optional } from '@nestjs/common';
import { DocumentsService } from '../../documents/documents.service';
import { KnowledgeService } from '../knowledge.service';
import { LlmService } from '../llm.service';
import { AsyncEventQueue } from './async-event-queue';
import { createRagGraph } from './rag-graph.factory';
import { type RagGraphStateData } from './rag-state';

@Injectable()
export class RagGraphService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly llmService: LlmService,
    @Optional() @Inject(KnowledgeService) private readonly knowledgeService?: KnowledgeService,
  ) {}

  async run(
    initialState: RagGraphStateData,
    queue: AsyncEventQueue<import('../chat.service').ChatStreamEvent>,
  ): Promise<RagGraphStateData | undefined> {
    const graph = createRagGraph({
      documentsService: this.documentsService,
      llmService: this.llmService,
      knowledgeService: this.knowledgeService,
      onEvent: (event) => queue.push(event),
    });

    let finalState: RagGraphStateData;
    try {
      finalState = await graph.invoke(initialState);
    } catch (error) {
      queue.fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    queue.close();
    return finalState;
  }
}
