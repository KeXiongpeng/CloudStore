'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import FileRow from '@/components/FileRow';

interface FileItem {
  id: string;
  originalName: string;
  urlKey: string;
  fileSize: number;
  mimeType: string;
  isPrivate: boolean;
  viewCount: number;
  downloadCount: number;
  createdAt: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
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
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">文件管理</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          共 {total} 个文件
        </span>
      </div>

      {loading ? (
        <div className="mt-6 text-center text-gray-500 dark:text-gray-400">
          加载中...
        </div>
      ) : files.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-gray-500 dark:text-gray-400">还没有上传过文件</p>
          <a
            href="/upload"
            className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            去上传
          </a>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    文件名
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    大小
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    浏览/下载
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    上传时间
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <FileRow key={file.id} file={file} onDelete={handleDelete} />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
