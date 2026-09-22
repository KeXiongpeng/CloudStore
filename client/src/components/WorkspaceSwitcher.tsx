'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useWorkspaces } from '@/features/workspace/api';
import { useWorkspaceStore } from '@/features/workspace/store';

export default function WorkspaceSwitcher() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const currentWorkspace = useWorkspaceStore((state) => state.currentWorkspace);
  const setCurrentWorkspace = useWorkspaceStore((state) => state.setCurrentWorkspace);

  useEffect(() => {
    if (!currentWorkspace && workspaces?.length) {
      setCurrentWorkspace(workspaces[0]);
    }
  }, [currentWorkspace, setCurrentWorkspace, workspaces]);

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-slate-600 dark:text-slate-300" htmlFor="workspace-switcher">
        工作区
      </label>
      <select
        id="workspace-switcher"
        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
        disabled={isLoading || !workspaces?.length}
        value={currentWorkspace?.id ?? ''}
        onChange={(event) => {
          const workspace = workspaces?.find((item) => item.id === event.target.value);
          setCurrentWorkspace(workspace ?? null);
        }}
      >
        <option value="" disabled>
          {isLoading ? '加载中...' : '选择工作区'}
        </option>
        {workspaces?.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name} · {workspace.role}
          </option>
        ))}
      </select>
      <Link
        href="/workspaces/new"
        className="rounded-lg px-3 py-1.5 text-sm text-blue-600 transition hover:bg-blue-50 dark:hover:bg-blue-950"
      >
        新建
      </Link>
    </div>
  );
}
