import {
  hasWorkspacePermission,
  WORKSPACE_ROLE_PERMISSIONS,
} from '../../src/workspaces/permissions';

describe('workspace permission matrix', () => {
  it('grants every permission to OWNER', () => {
    const permissions = Object.values(WORKSPACE_ROLE_PERMISSIONS.OWNER);
    expect(permissions.every(Boolean)).toBe(true);
  });

  it('prevents ADMIN from deleting a workspace', () => {
    expect(hasWorkspacePermission('ADMIN', 'workspace:delete')).toBe(false);
  });

  it('allows EDITOR to upload and delete files', () => {
    expect(hasWorkspacePermission('EDITOR', 'file:upload')).toBe(true);
    expect(hasWorkspacePermission('EDITOR', 'file:delete')).toBe(true);
  });

  it('allows VIEWER view/download but not upload', () => {
    expect(hasWorkspacePermission('VIEWER', 'file:view')).toBe(true);
    expect(hasWorkspacePermission('VIEWER', 'file:download')).toBe(true);
    expect(hasWorkspacePermission('VIEWER', 'file:upload')).toBe(false);
  });

  it('does not grant unknown permission values', () => {
    expect(hasWorkspacePermission('OWNER', 'unknown:permission' as never)).toBe(false);
  });
});
