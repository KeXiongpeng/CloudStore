'use client';

import { useState } from 'react';
import type { UploadItem } from '@/hooks/useUpload';

interface UploadProgressProps {
  item: UploadItem;
  onRemove: (id: string) => void;
}

export default function UploadProgress({ item, onRemove }: UploadProgressProps) {
  const [copied, setCopied] = useState(false);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const statusColor = {
    pending: 'text-gray-500',
    uploading: 'text-blue-500',
    success: 'text-green-500',
    error: 'text-red-500',
  };

  const statusText = {
    pending: '等待中',
    uploading: '上传中',
    success: '已完成',
    error: '失败',
  };

  const fileUrl = item.result ? `${window.location.origin}/f/${item.result.urlKey}` : '';

  const handleCopy = async () => {
    if (!fileUrl) return;
    await navigator.clipboard.writeText(fileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
            {item.file.name}
          </p>
          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatSize(item.file.size)}
            </span>
            <span className={`text-xs font-medium ${statusColor[item.status]}`}>
              {statusText[item.status]}
            </span>
            <button
              onClick={() => onRemove(item.id)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              &times;
            </button>
          </div>
        </div>

        {item.status === 'uploading' && (
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}

        {item.status === 'success' && item.result && (
          <div className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs text-gray-500 dark:text-gray-400">
              {fileUrl}
            </span>
            <button
              onClick={handleCopy}
              className="shrink-0 rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
            >
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
        )}

        {item.status === 'error' && <p className="mt-1 text-xs text-red-500">{item.error}</p>}
      </div>
    </div>
  );
}
