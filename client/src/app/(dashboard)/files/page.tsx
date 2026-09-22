'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import FileRow from '@/components/FileRow';
import FileCard, { FileItem } from '@/components/FileCard';

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const limit = 20;

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/files', { params: { page, limit } });
      setFiles(response.data.items);
      setTotal(response.data.total);
    } catch (error) {
      console.error('获取文件列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleDelete = async (fileId: string) => {
    try {
      await api.delete(`/files/${fileId}`);
      fetchFiles();
    } catch (error) {
      console.error('删除文件失败:', error);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="mx-auto w-full max-w-7xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">文件管理</h1>
          <p className="mt-1 text-sm text-slate-500">管理分享链接、预览文件和查看访问数据。</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-sm text-slate-500 shadow-sm">
          共 {total} 个文件
        </span>
      </div>

      {loading ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
          加载中...
        </div>
      ) : files.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="text-slate-500">还没有上传过文件</p>
          <Link
            href="/upload"
            className="mt-4 inline-flex h-10 items-center rounded-xl bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700"
          >
            去上传
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-6 space-y-3 md:hidden">
            {files.map((file) => (
              <FileCard
                key={file.id}
                file={file}
                onDelete={handleDelete}
                onPreview={setPreviewFile}
              />
            ))}
          </div>

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
                    onPreview={setPreviewFile}
                  />
                ))}
              </tbody>
            </table>
          </div>

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
        </>
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
              <h2
                className="min-w-0 truncate text-sm font-semibold text-slate-900 sm:text-base"
                title={previewFile.originalName}
              >
                {previewFile.originalName}
              </h2>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="关闭预览"
              >
                <svg className="size-5" viewBox="0 0 24 24" fill="none">
                  <path
                    d="m6 6 12 12M18 6 6 18"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
              {previewFile.mimeType.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/public/files/${previewFile.urlKey}/content`}
                  alt={previewFile.originalName}
                  className="mx-auto max-h-[78vh] max-w-full object-contain"
                />
              ) : previewFile.mimeType.startsWith('video/') ? (
                <video
                  src={`/api/public/files/${previewFile.urlKey}/content`}
                  controls
                  className="max-h-[78vh] w-full"
                >
                  您的浏览器不支持视频播放
                </video>
              ) : previewFile.mimeType.startsWith('audio/') ? (
                <audio
                  src={`/api/public/files/${previewFile.urlKey}/content`}
                  controls
                  className="w-full"
                >
                  您的浏览器不支持音频播放
                </audio>
              ) : previewFile.mimeType === 'application/pdf' ? (
                <iframe
                  src={`/api/public/files/${previewFile.urlKey}/content`}
                  className="h-[76vh] w-full border-0"
                  title={previewFile.originalName}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                  <p className="text-sm">该文件类型不支持页内预览</p>
                  <a
                    href={`/api/public/files/${previewFile.urlKey}/download`}
                    className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-500"
                  >
                    点击下载文件
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
