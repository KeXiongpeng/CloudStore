import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActorContext } from '../workspaces/types';

export type KnowledgeStats = {
  totalFiles: number;
  indexableFiles: number;
  indexed: number;
  processing: number;
  pending: number;
  failed: number;
  unsupported: number;
  lastIndexedAt: Date | null;
};

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(actor: Pick<WorkspaceActorContext, 'workspaceId'>): Promise<KnowledgeStats> {
    const files = await this.prisma.file.findMany({
      where: { workspaceId: actor.workspaceId, deletedAt: null },
      select: {
        name: true,
        documents: { select: { indexStatus: true, indexedAt: true } },
      },
    });

    const stats: KnowledgeStats = {
      totalFiles: files.length,
      indexableFiles: 0,
      indexed: 0,
      processing: 0,
      pending: 0,
      failed: 0,
      unsupported: 0,
      lastIndexedAt: null,
    };

    for (const file of files) {
      const isIndexable = /\.(md|txt|pdf)$/i.test(file.name);
      if (!isIndexable) {
        stats.unsupported += 1;
        continue;
      }

      stats.indexableFiles += 1;
      const status = file.documents[0]?.indexStatus ?? 'pending';
      if (status === 'indexed' || status === 'processing' || status === 'failed') {
        stats[status] += 1;
      } else {
        stats.pending += 1;
      }

      const indexedAt = file.documents[0]?.indexedAt;
      if (indexedAt && (!stats.lastIndexedAt || indexedAt > stats.lastIndexedAt)) {
        stats.lastIndexedAt = indexedAt;
      }
    }

    return stats;
  }
}
