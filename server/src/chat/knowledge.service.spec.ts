import { KnowledgeService } from './knowledge.service';

const file = (name: string, status?: string, indexedAt?: Date) => ({
  name,
  documents: status ? [{ indexStatus: status, indexedAt: indexedAt ?? null }] : [],
});

describe('KnowledgeService', () => {
  it('aggregates indexable file status from their documents', async () => {
    const prisma = {
      file: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            file('seo.md', 'indexed', new Date('2026-09-29T07:00:00.000Z')),
            file('kyc.pdf', 'processing'),
            file('notes.txt', 'failed'),
            file('pending.md'),
            file('photo.jpg'),
          ]),
      },
    };
    const service = new KnowledgeService(prisma as never);

    await expect(service.getStats({ workspaceId: 'workspace-1' } as never)).resolves.toEqual({
      totalFiles: 5,
      indexableFiles: 4,
      indexed: 1,
      processing: 1,
      pending: 1,
      failed: 1,
      unsupported: 1,
      lastIndexedAt: new Date('2026-09-29T07:00:00.000Z'),
    });
    expect(prisma.file.findMany).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-1', deletedAt: null },
      select: { name: true, documents: { select: { indexStatus: true, indexedAt: true } } },
    });
  });

  it('returns an empty healthy baseline when workspace has no files', async () => {
    const prisma = { file: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new KnowledgeService(prisma as never);

    await expect(service.getStats({ workspaceId: 'workspace-1' } as never)).resolves.toEqual({
      totalFiles: 0,
      indexableFiles: 0,
      indexed: 0,
      processing: 0,
      pending: 0,
      failed: 0,
      unsupported: 0,
      lastIndexedAt: null,
    });
  });
});
