import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Workspace, WorkspaceInvitation, WorkspaceMember, WorkspaceRole } from './types';

export const workspaceKeys = {
  all: ['workspaces'] as const,
  members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
  invitations: (workspaceId: string) => ['workspaces', workspaceId, 'invitations'] as const,
};

interface WorkspaceMembershipResponse {
  id: string;
  role: WorkspaceRole;
  workspace: Omit<Workspace, 'role'>;
}

export interface AuditLog {
  id: string;
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: async () => {
      const response = await api.get<WorkspaceMembershipResponse[]>('/workspaces');
      return response.data.map<Workspace>((membership) => ({
        ...membership.workspace,
        role: membership.role,
      }));
    },
  });
}

export function useAuditLogs(
  workspaceId: string,
  query: { page?: number; limit?: number; action?: string } = {},
) {
  return useQuery({
    queryKey: [...workspaceKeys.all, workspaceId, 'audit-logs', query],
    queryFn: async () => {
      const response = await api.get<AuditLogPage>(`/workspaces/${workspaceId}/audit-logs`, {
        params: query,
      });
      return response.data;
    },
    enabled: Boolean(workspaceId),
  });
}
export function useCreateWorkspace() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string }) => {
      const response = await api.post<Workspace>('/workspaces', input);
      return response.data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}

export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: async () => {
      const response = await api.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`);
      return response.data;
    },
    enabled: Boolean(workspaceId),
  });
}

export function useWorkspaceInvitations(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.invitations(workspaceId),
    queryFn: async () => {
      const response = await api.get<WorkspaceInvitation[]>(
        `/workspaces/${workspaceId}/invitations`,
      );
      return response.data;
    },
    enabled: Boolean(workspaceId),
  });
}

export function useInviteMember(workspaceId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { email: string; role: Exclude<WorkspaceRole, 'OWNER'> }) => {
      const response = await api.post(`/workspaces/${workspaceId}/invitations`, input);
      return response.data as WorkspaceInvitation & { token: string };
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: workspaceKeys.invitations(workspaceId) });
    },
  });
}

export function useUpdateMemberRole(workspaceId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (input: { memberId: string; role: Exclude<WorkspaceRole, 'OWNER'> }) => {
      const response = await api.patch(`/workspaces/${workspaceId}/members/${input.memberId}`, {
        role: input.role,
      });
      return response.data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) }),
  });
}

export function useRemoveMember(workspaceId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (memberId: string) => {
      await api.delete(`/workspaces/${workspaceId}/members/${memberId}`);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) }),
  });
}

export function useAcceptInvitation() {
  return useMutation({
    mutationFn: async (token: string) => {
      const response = await api.post('/invitations/accept', { token });
      return response.data;
    },
  });
}
