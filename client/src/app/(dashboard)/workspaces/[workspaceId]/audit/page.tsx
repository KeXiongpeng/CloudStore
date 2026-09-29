'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useAuditLogs } from '@/features/workspace/api';
import { UI_PERMISSIONS } from '@/features/workspace/types';
import { useWorkspaceStore } from '@/features/workspace/store';

const actionLabels: Record<string, string> = {
  'member.invited': '邀请成员',
  'member.joined': '成员加入',
  'member.role_changed': '角色变更',
  'member.removed': '移除成员',
  'workspace.created': '创建工作区',
  'workspace.updated': '更新工作区',
  'workspace.deleted': '删除工作区',
  'workspace.migrated': '工作区迁移',
};

export default function WorkspaceAuditPage() {
  const params = useParams<{ workspaceId: string }>();
  const workspaceId = params.workspaceId;
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const [page, setPage] = useState(1);
  const auditLogs = useAuditLogs(workspaceId, { page, limit: 20 });
  const permissions = UI_PERMISSIONS[currentWorkspace?.role ?? 'GUEST'];

  if (!permissions.viewAudit) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800 dark:border-amber-900 dark:bg-amber-950">
        当前角色没有查看审计日志的权限。
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">审计日志</h1>
        <p className="text-sm text-slate-500">{currentWorkspace?.name}</p>
      </div>

      {auditLogs.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {auditLogs.error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
          <thead className="bg-slate-50 text-left text-xs uppercase dark:bg-slate-900">
            <tr>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">操作</th>
              <th className="px-4 py-3">资源</th>
              <th className="px-4 py-3">操作者</th>
              <th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
            {auditLogs.data?.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3 text-sm">{new Date(item.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3 text-sm font-medium">
                  {actionLabels[item.action] || item.action}
                </td>
                <td className="px-4 py-3 text-sm">
                  {item.resourceType}
                  <span className="ml-1 text-slate-400">#{item.resourceId.slice(0, 8)}</span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{item.actorId || '-'}</td>
                <td className="px-4 py-3 text-sm">{item.ip || '-'}</td>
              </tr>
            ))}
            {auditLogs.data && auditLogs.data.items.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                  暂无审计日志。
                </td>
              </tr>
            )}
            {auditLogs.isLoading && (
              <tr>
                <td className="px-4 py-6 text-center text-slate-500" colSpan={5}>
                  加载中...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {auditLogs.data && auditLogs.data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-sm text-slate-500">
            第 {auditLogs.data.page} / {auditLogs.data.totalPages} 页
          </span>
          <button
            type="button"
            disabled={page >= auditLogs.data.totalPages}
            onClick={() => setPage((value) => value + 1)}
            className="rounded-lg border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
