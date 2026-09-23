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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const limit = 100;
  const scrollRef = useRef<HTMLDivElement>(null);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewError(null);
  }, []);

  const openPreview = useCallback(
    async (file: FileItem) => {
      if (!workspace) return;
      setPreviewFile(file);
      setPreviewUrl(null);
      setPreviewError(null);
      setPreviewLoading(true);
      try {
        const response = await api.get(`/workspaces/${workspace.id}/files/${file.id}/access-url`, {
          params: { mode: 'preview' },
        });
        setPreviewUrl(response.data.url);
      } catch (error) {
        console.error('\u83b7\u53d6\u9884\u89c8\u5931\u8d25:', error);
        setPreviewError('\u9884\u89c8\u52a0\u8f7d\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5');
      } finally {
        setPreviewLoading(false);
      }
    },
    [workspace],
  );

  const handleDownload = useCallback(
    async (file: FileItem) => {
      if (!workspace) return;
      try {
        const response = await api.get(`/workspaces/${workspace.id}/files/${file.id}/access-url`, {
          params: { mode: 'download' },
        });
        window.open(response.data.url, '_blank', 'noopener,noreferrer');
      } catch (error) {
        console.error('\u4e0b\u8f7d\u5931\u8d25:', error);
      }
    },
    [workspace],
  );

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
      console.error('\u83b7\u53d6\u6587\u4ef6\u5217\u8868\u5931\u8d25:', error);
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
    const previousFiles = files;
    const previousTotal = total;

    setFiles((current) => current.filter((file) => file.id !== fileId));
    setTotal((current) => Math.max(0, current - 1));

    try {
      await api.delete(`/workspaces/${workspace.id}/files/${fileId}`);
    } catch (error) {
      console.error('\u5220\u9664\u6587\u4ef6\u5931\u8d25:', error);
      setFiles(previousFiles);
      setTotal(previousTotal);
    }
  };

  const virtualRows = useMemo(() => virtualizer.getVirtualItems(), [virtualizer]);
  const totalPages = Math.ceil(total / limit);
  const shouldVirtualize = files.length > 50;

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">文件管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            {workspace ? `当前工作区：${workspace.name}` : '请先选择工作区'}
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-500 shadow-sm">
          共 {total} 个文件
        </span>
      </div>

      {canUpload && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <UploadDropzone disabled={!canUpload} />
          <UploadQueuePanel />
        </div>
      )}

      {loading ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          加载中...
        </div>
      ) : files.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-500">还没有上传过文件</p>
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
                  <FileCard
                    file={file}
                    onDelete={handleDelete}
                    onPreview={openPreview}
                    onDownload={handleDownload}
                  />
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
                  文件名
                </th>
                <th className="w-[10%] px-4 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  大小
                </th>
                <th className="w-[14%] px-4 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  浏览/下载
                </th>
                <th className="w-[18%] px-4 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  上传时间
                </th>
                <th className="w-[22%] px-5 py-4 text-left text-xs font-medium uppercase text-slate-500">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  onDelete={handleDelete}
                  onPreview={openPreview}
                  onDownload={handleDownload}
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
            上一页
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
            下一页
          </button>
        </div>
      )}

      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-3 sm:p-4"
          onClick={closePreview}
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
                onClick={closePreview}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-slate-500 hover:bg-slate-100"
                aria-label="\u5173\u95ed\u9884\u89c8"
              >
                &times;
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
              {previewLoading && (
                <div className="flex h-[60vh] items-center justify-center text-slate-500">
                  &#21152;&#36733;&#20013;...
                </div>
              )}
              {previewError && (
                <div className="flex h-[60vh] items-center justify-center text-red-500">
                  {previewError}
                </div>
              )}
              {!previewLoading && !previewError && previewUrl && (
                <div className="flex h-full flex-col gap-4">
                  <div className="min-h-0 flex-1">
                    {previewFile.mimeType.startsWith('image/') ||
                    previewFile.mimeType.startsWith('video/') ||
                    previewFile.mimeType.startsWith('audio/') ||
                    previewFile.mimeType.startsWith('text/') ||
                    previewFile.mimeType === 'application/pdf' ? (
                      <iframe
                        src={previewUrl}
                        className="h-[68vh] w-full rounded-xl border border-slate-200"
                        title={previewFile.originalName}
                      />
                    ) : (
                      <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-slate-500">
                        <p>
                          &#35813;&#25991;&#20214;&#31867;&#22411;&#19981;&#25903;&#25345;&#22312;&#32447;&#39044;&#35272;
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex justify-center">
                    <button
                      type="button"
                      onClick={() => window.open(previewUrl, '_blank', 'noopener,noreferrer')}
                      className="rounded-xl bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      &#19979;&#36733;&#25991;&#20214;
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
