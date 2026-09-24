'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getApiErrorMessage } from '@/lib/errors';
import {
  useInviteMember,
  useRemoveMember,
  useUpdateMemberRole,
  useWorkspaceInvitations,
  useWorkspaceMembers,
  workspaceKeys,
} from '@/features/workspace/api';
import { UI_PERMISSIONS, WorkspaceRole } from '@/features/workspace/types';
import { useWorkspaceStore } from '@/features/workspace/store';

const inviteSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER', 'GUEST']),
});
type InviteFormValues = z.infer<typeof inviteSchema>;

const roleLabels: Record<WorkspaceRole, string> = {
  OWNER: '所有者',
  ADMIN: '管理员',
  EDITOR: '编辑者',
  VIEWER: '查看者',
  GUEST: '访客',
};

export default function WorkspaceMembersPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const queryClient = useQueryClient();
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const members = useWorkspaceMembers(workspaceId);
  const invitations = useWorkspaceInvitations(workspaceId);
  const inviteMember = useInviteMember(workspaceId);
  const updateRole = useUpdateMemberRole(workspaceId);
  const removeMember = useRemoveMember(workspaceId);
  const [invitedToken, setInvitedToken] = useState('');
  const [actionError, setActionError] = useState('');
  const { register, handleSubmit, reset, formState } = useForm<InviteFormValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', role: 'VIEWER' },
  });

  const permissions = UI_PERMISSIONS[currentWorkspace?.role ?? 'GUEST'];
  const errorMessage =
    actionError ||
    inviteMember.error?.message ||
    updateRole.error?.message ||
    removeMember.error?.message;

  async function runAction(action: () => Promise<unknown>) {
    setActionError('');
    try {
      await action();
    } catch (error) {
      setActionError(getApiErrorMessage(error, '操作失败'));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">成员管理</h1>
          <p className="text-sm text-slate-500">{currentWorkspace?.name || '未选择工作区'}</p>
        </div>
        <a className="text-sm text-blue-600" href="/admin/audit">
          查看审计日志
        </a>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {permissions.manageMembers && (
        <form
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 md:grid-cols-[2fr_1fr_auto]"
          onSubmit={handleSubmit(async (values) => {
            await runAction(async () => {
              const invitation = await inviteMember.mutateAsync(values);
              setInvitedToken(invitation.token);
              reset();
              await queryClient.invalidateQueries({
                queryKey: workspaceKeys.invitations(workspaceId),
              });
            });
          })}
        >
          <input
            {...register('email')}
            placeholder="被邀请人邮箱"
            className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          />
          <select
            {...register('role')}
            className="rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
          >
            <option value="ADMIN">管理员</option>
            <option value="EDITOR">编辑者</option>
            <option value="VIEWER">查看者</option>
            <option value="GUEST">访客</option>
          </select>
          <button
            type="submit"
            disabled={inviteMember.isPending || formState.isSubmitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
          >
            邀请
          </button>
        </form>
      )}

      {invitedToken && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
          邀请令牌已生成：<code className="break-all font-mono">{invitedToken}</code>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 text-left text-xs uppercase dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3">成员</th>
              <th className="px-4 py-3">角色</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
            {members.data?.map((member) => (
              <tr key={member.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{member.user.nickname || member.user.email}</div>
                  <div className="text-sm text-slate-500">{member.user.email}</div>
                </td>
                <td className="px-4 py-3">
                  {member.role === 'OWNER' || !permissions.manageMembers ? (
                    roleLabels[member.role]
                  ) : (
                    <select
                      value={member.role}
                      className="rounded-lg border border-slate-200 px-2 py-1 dark:border-slate-700 dark:bg-slate-900"
                      onChange={(event) =>
                        runAction(() =>
                          updateRole.mutateAsync({
                            memberId: member.id,
                            role: event.target.value as Exclude<WorkspaceRole, 'OWNER'>,
                          }),
                        )
                      }
                    >
                      <option value="ADMIN">管理员</option>
                      <option value="EDITOR">编辑者</option>
                      <option value="VIEWER">查看者</option>
                      <option value="GUEST">访客</option>
                    </select>
                  )}
                </td>
                <td className="px-4 py-3">{member.status}</td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={member.role === 'OWNER' || !permissions.manageMembers}
                    onClick={() => runAction(() => removeMember.mutateAsync(member.id))}
                    className="rounded-lg px-3 py-1 text-sm text-red-600 disabled:opacity-40"
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
            {members.isLoading && (
              <tr>
                <td className="px-4 py-4 text-slate-500" colSpan={4}>
                  加载中...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {permissions.manageMembers && (
        <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="mb-3 font-semibold">待处理邀请</h2>
          <div className="space-y-2">
            {invitations.data?.length ? (
              invitations.data.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 dark:bg-slate-900"
                >
                  <span>{invitation.email}</span>
                  <span>{roleLabels[invitation.role]}</span>
                  <span className="text-sm text-slate-500">
                    到期 {new Date(invitation.expiresAt).toLocaleString()}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">暂无待处理邀请。</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
