'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspaceStore } from '@/features/workspace/store';

export default function UploadPage() {
  const router = useRouter();
  const workspace = useWorkspaceStore((state) => state.currentWorkspace);

  useEffect(() => {
    router.replace('/files?upload=1');
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
        上传页已整合到「文件与知识库」，正在跳转...
        {workspace ? `（当前工作区：${workspace.name}）` : ''}
      </div>
    </div>
  );
}
