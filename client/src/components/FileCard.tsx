'use client';

import { useEffect, useState } from 'react';

export interface FileItem {
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

interface FileCardProps {
  file: FileItem;
  onDelete: (id: string) => void;
  onPreview: (file: FileItem) => void;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatFileDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (/zip|tar|7z/.test(mimeType)) return '📦';
  return '📎';
}

export default function FileCard({ file, onDelete, onPreview }: FileCardProps) {
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(`${origin}/f/${file.urlKey}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = () => {
    if (confirm(`确定要删除 ${file.originalName} 吗？`)) {
      onDelete(file.id);
    }
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span className="text-xl">{getFileIcon(file.mimeType)}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900" title={file.originalName}>
            {file.originalName}
          </h3>
          <p className="mt-1 truncate text-xs text-slate-500">{file.mimeType}</p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-slate-500">大小</dt>
          <dd className="mt-1 font-medium text-slate-800">{formatFileSize(file.fileSize)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <dt className="text-slate-500">浏览 / 下载</dt>
          <dd className="mt-1 font-medium text-slate-800">
            {file.viewCount} / {file.downloadCount}
          </dd>
        </div>
        <div className="col-span-2 rounded-xl bg-slate-50 p-3">
          <dt className="text-slate-500">上传时间</dt>
          <dd className="mt-1 font-medium text-slate-800">{formatFileDate(file.createdAt)}</dd>
        </div>
      </dl>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => onPreview(file)}
          className="h-9 rounded-xl bg-blue-50 text-xs font-medium text-blue-700 transition hover:bg-blue-100"
        >
          预览
        </button>
        <button
          type="button"
          onClick={handleCopyLink}
          className="h-9 rounded-xl bg-slate-100 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
        >
          {copied ? '已复制' : '复制链接'}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="h-9 rounded-xl bg-red-50 text-xs font-medium text-red-600 transition hover:bg-red-100"
        >
          删除
        </button>
      </div>
    </article>
  );
}
