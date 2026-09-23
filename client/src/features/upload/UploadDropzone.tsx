'use client';

import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useWorkspaceStore } from '../workspace/store';
import { runQueuedUploads } from './runner';
import { useUploadQueue } from './store';

export function UploadDropzone({ folderId }: { folderId?: string }) {
  const workspace = useWorkspaceStore((state) => state.currentWorkspace);
  const enqueueFiles = useUploadQueue((state) => state.enqueueFiles);
  const [dragging, setDragging] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!workspace) return;
      enqueueFiles(acceptedFiles, workspace.id, folderId);
      await runQueuedUploads();
    },
    [enqueueFiles, folderId, workspace],
  );

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    onDragEnter: () => setDragging(true),
    onDragLeave: () => setDragging(false),
    onDropAccepted: () => setDragging(false),
    noClick: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`rounded-xl border-2 border-dashed p-8 text-center transition ${
        dragging
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
          : 'border-neutral-300 dark:border-neutral-700'
      }`}
    >
      <input {...getInputProps()} />
      <p className="text-sm text-neutral-600 dark:text-neutral-300">?????????????????</p>
      {!workspace && <p className="mt-1 text-xs text-red-500">???????</p>}
    </div>
  );
}
