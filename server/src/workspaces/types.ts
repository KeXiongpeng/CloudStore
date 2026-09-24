export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'GUEST';

export type WorkspacePermission =
  | 'workspace:view'
  | 'workspace:update'
  | 'workspace:delete'
  | 'member:read'
  | 'member:invite'
  | 'member:update_role'
  | 'member:remove'
  | 'audit:read'
  | 'file:view'
  | 'file:upload'
  | 'file:download'
  | 'file:update'
  | 'file:delete'
  | 'quota:read'
  | 'quota:update';

export interface WorkspaceActorContext {
  userId: string;
  workspaceId: string;
  memberId: string;
  role: WorkspaceRole;
}
