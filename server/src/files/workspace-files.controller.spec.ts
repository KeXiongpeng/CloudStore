import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { WorkspaceFilesController } from '../../src/files/workspace-files.controller';
import {
  WorkspaceFileAccessService,
  WorkspaceFilesService,
} from '../../src/files/workspace-files.service';
import { PermissionGuard, WorkspaceGuard } from '../../src/workspaces';

const actor = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  memberId: 'member-1',
  role: 'OWNER' as const,
};

const filesService = {
  list: jest.fn(async () => ({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 })),
};

describe('WorkspaceFilesController pagination', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkspaceFilesController],
      providers: [
        { provide: WorkspaceFilesService, useValue: filesService },
        { provide: WorkspaceFileAccessService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().workspaceActor = actor;
          return true;
        },
      })
      .overrideGuard(WorkspaceGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().workspaceActor = actor;
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    filesService.list.mockClear();
  });

  it('accepts a file list request without pagination query params', async () => {
    const response = await request(app.getHttpServer()).get('/workspaces/workspace-1/files');

    expect(response.status).toBe(200);
    expect(filesService.list).toHaveBeenCalledWith(actor, 1, 20);
  });

  it('accepts numeric pagination query params', async () => {
    const response = await request(app.getHttpServer()).get(
      '/workspaces/workspace-1/files?page=2&limit=5',
    );

    expect(response.status).toBe(200);
    expect(filesService.list).toHaveBeenCalledWith(actor, 2, 5);
  });

  it('rejects non-numeric pagination query params', async () => {
    const response = await request(app.getHttpServer()).get(
      '/workspaces/workspace-1/files?page=abc',
    );

    expect(response.status).toBe(400);
    expect(filesService.list).not.toHaveBeenCalled();
  });
});
