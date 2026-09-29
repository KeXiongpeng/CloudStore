'use client';

import { useState } from 'react';
import QrCodeDialog from './QrCodeDialog';

interface PreviewToolbarProps {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadTime: string;
  uploaderName: string;
  viewCount: number;
  downloadCount: number;
}

export default function PreviewToolbar({
  fileUrl,
  fileName,
  fileSize,
  mimeType,
  uploadTime,
  uploaderName,
  viewCount,
  downloadCount,
}: PreviewToolbarProps) {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(fileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <p
            className="truncate text-sm font-medium text-gray-900 dark:text-white"
            title={fileName}
          >
            {fileName}
          </p>
          <span className="text-xs text-gray-400">
            {formatSize(fileSize)} · {viewCount} 次浏览 · {downloadCount} 次下载
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            title="复制链接"
          >
            {copied ? '已复制' : '复制链接'}
          </button>
          <button
            onClick={() => setShowQr(true)}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            title="二维码"
          >
            二维码
          </button>
          <a
            href={`/d/${fileUrl.split('/f/')[1] || ''}`}
            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
            title="下载"
          >
            下载
          </a>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            详情
          </button>
        </div>
      </div>

      {showInfo && (
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-4">
            <p>类型: {mimeType}</p>
            <p>大小: {formatSize(fileSize)}</p>
            <p>上传: {new Date(uploadTime).toLocaleDateString('zh-CN')}</p>
            <p>上传者: {uploaderName}</p>
          </div>
        </div>
      )}

      <QrCodeDialog url={fileUrl} isOpen={showQr} onClose={() => setShowQr(false)} />
    </>
  );
}
