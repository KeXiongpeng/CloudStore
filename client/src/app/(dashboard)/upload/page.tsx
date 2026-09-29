'use client';

import { useWorkspaceStore } from '@/features/workspace/store';
import { UI_PERMISSIONS } from '@/features/workspace/types';
import { UploadDropzone } from '@/features/upload/UploadDropzone';
import { UploadQueuePanel } from '@/features/upload/UploadQueuePanel';

export default function UploadPage() {
  const workspace = useWorkspaceStore((state) => state.currentWorkspace);
  const canUpload = workspace ? UI_PERMISSIONS[workspace.role].upload : false;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">上传文件</h1>
          <p className="mt-1 text-sm text-slate-500">
            {workspace ? `当前工作区：${workspace.name}` : '请先选择工作区'}
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <UploadDropzone disabled={!canUpload} />
        <UploadQueuePanel />
      </div>
    </div>
  );
}
