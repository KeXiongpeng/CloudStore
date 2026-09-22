import { Test } from '@nestjs/testing';
import { WorkspaceCoreModule } from '../../src/workspaces/workspace-core.module';
import { WorkspacesService } from '../../src/workspaces/workspaces.service';
import { WorkspaceGuard } from '../../src/workspaces/guards/workspace.guard';
import { PermissionGuard } from '../../src/workspaces/guards/permission.guard';

describe('WorkspaceCoreModule', () => {
  it('provides the shared workspace service and guards', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WorkspaceCoreModule],
    }).compile();

    expect(moduleRef.get(WorkspacesService)).toBeInstanceOf(WorkspacesService);
    expect(moduleRef.get(WorkspaceGuard)).toBeInstanceOf(WorkspaceGuard);
    expect(moduleRef.get(PermissionGuard)).toBeInstanceOf(PermissionGuard);
  });
});
