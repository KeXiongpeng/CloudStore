'use client';

import { useEffect, useState } from 'react';
import { FileItem, formatFileDate, formatFileSize, getFileIcon } from '@/components/FileCard';

interface FileRowProps {
  file: FileItem;
  onDelete: (id: string) => void;
  onPreview: (file: FileItem) => void;
  onDownload: (file: FileItem) => void;
}

export default function FileRow({ file, onDelete, onPreview, onDownload }: FileRowProps) {
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
    if (confirm(`\u786e\u5b9a\u8981\u5220\u9664 ${file.originalName} \u5417\uff1f`)) {
      onDelete(file.id);
    }
  };

  return (
    <tr className="border-b border-slate-100 transition hover:bg-slate-50">
      <td className="px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-lg">{getFileIcon(file.mimeType)}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900" title={file.originalName}>
              {file.originalName}
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">{file.mimeType}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-4 text-sm text-slate-600">{formatFileSize(file.fileSize)}</td>
      <td className="px-4 py-4 text-sm text-slate-600">
        {file.viewCount} / {file.downloadCount}
      </td>
      <td className="px-4 py-4 text-sm text-slate-500">{formatFileDate(file.createdAt)}</td>
      <td className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onPreview(file)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
          >
            &#39044;&#35272;
          </button>
          <button
            type="button"
            onClick={() => onDownload(file)}
            className="rounded-lg px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-50"
          >
            &#19979;&#36733;
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            {copied ? '\u5df2\u590d\u5236' : '\u590d\u5236\u94fe\u63a5'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            &#21024;&#38500;
          </button>
        </div>
      </td>
    </tr>
  );
}
