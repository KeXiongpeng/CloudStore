import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('Workspace data isolation (e2e)', () => {
  let app: INestApplication;
  let ownerAToken: string;
  let ownerBToken: string;
  let ownerBEmail: string;
  let nonMemberToken: string;
  let workspaceA: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalInterceptors(
      new (
        await import('../../src/common/interceptors/response.interceptor')
      ).HttpResponseInterceptor(),
    );
    app.useGlobalFilters(
      new (await import('../../src/common/filters/http-exception.filter')).HttpExceptionFilter(),
    );
    await app.init();

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const registerAndLogin = async (prefix: string) => {
      const email = `${prefix}-${suffix}@example.com`;
      const registered = await request(app.getHttpServer()).post('/api/auth/register').send({
        email,
        password: 'Password123!',
      });

      if (!registered.ok) {
        throw new Error(`register failed: ${JSON.stringify(registered.body)}`);
      }

      const login = await request(app.getHttpServer()).post('/api/auth/login').send({
        email,
        password: 'Password123!',
      });

      if (!login.body?.data?.access_token) {
        throw new Error(`login failed: ${JSON.stringify(login.body)}`);
      }

      if (prefix === 'workspace-b') ownerBEmail = email;
      if (prefix === 'workspace-c') nonMemberToken = login.body.data.access_token as string;

      return login.body.data.access_token as string;
    };

    ownerAToken = await registerAndLogin('workspace-a');
    ownerBToken = await registerAndLogin('workspace-b');
    nonMemberToken = await registerAndLogin('workspace-c');

    const created = await request(app.getHttpServer())
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: `Workspace A ${suffix}` });
    workspaceA = created.body.data.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns audit logs for the workspace owner', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/workspaces/${workspaceA}/audit-logs`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .query({ page: 1, limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'workspace.created' })]),
    );
  });
  it('blocks a user who is not a member of workspace A', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/workspaces/${workspaceA}`)
      .set('Authorization', `Bearer ${nonMemberToken}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('prevents a non-member from inviting members', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceA}/invitations`)
      .set('Authorization', `Bearer ${nonMemberToken}`)
      .send({ email: 'new-member@example.com', role: 'VIEWER' });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('WORKSPACE_NOT_FOUND');
  });

  it('invites and accepts a member', async () => {
    const invited = await request(app.getHttpServer())
      .post(`/api/workspaces/${workspaceA}/invitations`)
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ email: ownerBEmail, role: 'EDITOR' });

    expect(invited.status).toBe(201);
    expect(invited.body.data.token).toHaveLength(64);

    const accepted = await request(app.getHttpServer())
      .post('/api/invitations/accept')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ token: invited.body.data.token });

    expect(accepted.status).toBe(201);
    expect(accepted.body.data.role).toBe('EDITOR');

    const visible = await request(app.getHttpServer())
      .get(`/api/workspaces/${workspaceA}`)
      .set('Authorization', `Bearer ${ownerBToken}`);

    expect(visible.status).toBe(200);
  });
});
