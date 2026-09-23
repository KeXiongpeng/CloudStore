'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import api from '@/lib/api';
import FileRow from '@/components/FileRow';
import FileCard, { FileItem } from '@/components/FileCard';
import { useWorkspaceStore } from '@/features/workspace/store';
import { UI_PERMISSIONS } from '@/features/workspace/types';
import { UploadDropzone } from '@/features/upload/UploadDropzone';
import { UploadQueuePanel } from '@/features/upload/UploadQueuePanel';
import { useUploadQueue } from '@/features/upload/store';

export default function FilesPage() {
  const workspace = useWorkspaceStore((state) => state.currentWorkspace);
  const canUpload = workspace ? UI_PERMISSIONS[workspace.role].upload : false;
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const limit = 100;
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  const fetchFiles = useCallback(async () => {
    if (!workspace) {
      setFiles([]);
      setTotal(0);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await api.get(`/workspaces/${workspace.id}/files`, {
        params: { page, limit },
      });
      setFiles(response.data.items);
      setTotal(response.data.total);
    } catch (error) {
      console.error('????????:', error);
    } finally {
      setLoading(false);
    }
  }, [page, workspace]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  useEffect(() => {
    let previousCompleted = 0;
    return useUploadQueue.subscribe((state) => {
      const completed = state.items.filter((item) => item.status === 'completed').length;
      if (completed > previousCompleted) fetchFiles();
      previousCompleted = completed;
    });
  }, [fetchFiles]);

  const handleDelete = async (fileId: string) => {
    if (!workspace) return;
    try {
      await api.delete(`/workspaces/${workspace.id}/files/${fileId}`);
      fetchFiles();
    } catch (error) {
      console.error('??????:', error);
    }
  };

  const virtualRows = useMemo(() => virtualizer.getVirtualItems(), [virtualizer]);
  const totalPages = Math.ceil(total / limit);
  const shouldVirtualize = files.length > 50;

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">????</h1>
          <p className="mt-1 text-sm text-slate-500">
            {workspace ? `??????${workspace.name}` : '???????'}
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-500 shadow-sm">
          ? {total} ???
        </span>
      </div>

      {canUpload && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <UploadDropzone />
          <UploadQueuePanel />
        </div>
      )}

      {!canUpload && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          ??????????
        </p>
      )}

      {loading ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          ???...
        </div>
      ) : files.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-500">????????</p>
        </div>
      ) : shouldVirtualize ? (
        <div
          ref={scrollRef}
          className="mt-6 h-[600px] overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualRows.map((row) => {
              const file = files[row.index];
              return (
                <div
                  key={file.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start}px)`,
                  }}
                  className="border-b border-slate-100 p-3"
                >
                  <FileCard file={file} onDelete={handleDelete} onPreview={setPreviewFile} />
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-6 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
          <table className="w-full table-fixed">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="w-[36%] px-5 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  ???
                </th>
                <th className="w-[10%] px-4 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  ??
                </th>
                <th className="w-[14%] px-4 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  ??/??
                </th>
                <th className="w-[18%] px-4 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  ????
                </th>
                <th className="w-[22%] px-5 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  ??
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  onDelete={handleDelete}
                  onPreview={setPreviewFile}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-5 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page === 1}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 disabled:opacity-50"
          >
            ???
          </button>
          <span className="rounded-xl bg-white px-4 py-2 text-sm text-slate-600 shadow-sm">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page === totalPages}
            className="h-10 rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-700 disabled:opacity-50"
          >
            ???
          </button>
        </div>
      )}

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-4"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base">
                {previewFile.originalName}
              </h2>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="????"
              >
                ?
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
              {previewFile.mimeType.startsWith('image/') ? (
                <iframe
                  src={`/api/public/files/${previewFile.urlKey}/content`}
                  className="h-[76vh] w-full border-0"
                  title={previewFile.originalName}
                />
              ) : (
                <div className="py-12 text-center">
                  <a
                    href={`/api/public/files/${previewFile.urlKey}/download`}
                    className="text-sm font-medium text-blue-600 hover:text-blue-500"
                  >
                    ????
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
