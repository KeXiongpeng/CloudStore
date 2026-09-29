import { NotFoundException } from '@nestjs/common';
import { Writable } from 'stream';
import type { Response } from 'express';
import { PassThrough } from 'stream';
import { WorkspaceFileAccessService } from '../../src/files/workspace-files.service';

function createRes() {
  const res = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as Writable & { setHeader: jest.Mock; status: jest.Mock };

  res.setHeader = jest.fn();
  res.status = jest.fn().mockReturnValue(res);
  return res as unknown as Response;
}

function createService(file: unknown, object: unknown) {
  const prisma = {
    file: { findFirst: jest.fn().mockResolvedValue(file) },
  };
  const storageService = {
    getObject: jest.fn().mockResolvedValue(object),
  };
  const service = new WorkspaceFileAccessService(prisma as never, storageService as never);
  return { service, prisma, storageService };
}

const baseFile = {
  id: 'file-1',
  name: '最终产出.txt',
  mimeType: 'text/plain',
  size: BigInt(7),
  currentVersion: { storageKey: 'ws/2026/09/key.txt' },
};

describe('WorkspaceFileAccessService.streamContent', () => {
  it('streams the object inline with utf-8 text headers', async () => {
    const body = new PassThrough();
    const { service, storageService } = createService(baseFile, {
      Body: body,
      ContentLength: 7,
    });
    const res = createRes();

    await service.streamContent(
      { workspaceId: 'ws-1', userId: 'u1', role: 'OWNER' } as never,
      'file-1',
      res as never,
    );

    expect(storageService.getObject).toHaveBeenCalledWith('ws/2026/09/key.txt', undefined);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent('最终产出.txt')}`,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '7');
    expect(res.setHeader).toHaveBeenCalledWith('Accept-Ranges', 'bytes');
    expect(res.status).not.toHaveBeenCalled();
    body.end();
  });

  it('passes binary mime types through untouched', async () => {
    const { service } = createService(
      { ...baseFile, mimeType: 'image/png' },
      { Body: new PassThrough(), ContentLength: 10 },
    );
    const res = createRes();

    await service.streamContent(
      { workspaceId: 'ws-1', userId: 'u1', role: 'OWNER' } as never,
      'file-1',
      res as never,
    );

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
  });

  it('honors range requests with a 206 response', async () => {
    const { service, storageService } = createService(baseFile, {
      Body: new PassThrough(),
      ContentLength: 4,
      ContentRange: 'bytes 0-3/7',
    });
    const res = createRes();

    await service.streamContent(
      { workspaceId: 'ws-1', userId: 'u1', role: 'OWNER' } as never,
      'file-1',
      res as never,
      'bytes=0-3',
    );

    expect(storageService.getObject).toHaveBeenCalledWith('ws/2026/09/key.txt', 'bytes=0-3');
    expect(res.status).toHaveBeenCalledWith(206);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Range', 'bytes 0-3/7');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '4');
  });

  it('throws when the file is missing', async () => {
    const { service } = createService(null, {});
    const res = createRes();

    await expect(
      service.streamContent(
        { workspaceId: 'ws-1', userId: 'u1', role: 'OWNER' } as never,
        'missing',
        res as never,
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
