export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'GUEST';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  role: WorkspaceRole;
}

export interface WorkspaceMember {
  id: string;
  role: WorkspaceRole;
  status: 'active' | 'disabled';
  user: {
    id: string;
    email: string;
    nickname?: string | null;
    avatarUrl?: string | null;
  };
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
}

export const UI_PERMISSIONS: Record<
  WorkspaceRole,
  { upload: boolean; manageMembers: boolean; viewAudit: boolean }
> = {
  OWNER: { upload: true, manageMembers: true, viewAudit: true },
  ADMIN: { upload: true, manageMembers: true, viewAudit: true },
  EDITOR: { upload: true, manageMembers: false, viewAudit: false },
  VIEWER: { upload: false, manageMembers: false, viewAudit: false },
  GUEST: { upload: false, manageMembers: false, viewAudit: false },
};
