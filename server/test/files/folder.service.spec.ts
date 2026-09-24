import { FolderService } from '../../src/files/folder.service';

const prisma: any = {
  folder: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn(prisma)),
};

describe('FolderService.ensureFolderPath', () => {
  it('reuses an existing path and creates only missing folders', async () => {
    prisma.folder.findFirst
      .mockResolvedValueOnce({ id: 'root', path: 'docs', name: 'docs', parentId: null })
      .mockResolvedValueOnce(null);
    prisma.folder.create.mockResolvedValue({
      id: 'child',
      path: 'docs/design',
      name: 'design',
      parentId: 'root',
    });

    const service = new FolderService(prisma as any);
    const result = await service.ensureFolderPath(
      { userId: 'u', workspaceId: 'w', memberId: 'm', role: 'EDITOR' },
      ['docs', 'design'],
    );

    expect(result).toEqual({ folderId: 'child' });
    expect(prisma.folder.create).toHaveBeenCalledTimes(1);
  });
});
