'use client';

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

interface FileRowProps {
  file: FileItem;
  onDelete: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('7z')) return '📦';
  return '📎';
}

export default function FileRow({ file, onDelete }: FileRowProps) {
  const fileUrl = `${window.location.origin}/f/${file.urlKey}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(fileUrl);
  };

  const handleDelete = () => {
    if (confirm(`确定要删除 ${file.originalName} 吗？`)) {
      onDelete(file.id);
    }
  };

  return (
    <tr className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-900">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-lg">{getFileIcon(file.mimeType)}</span>
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {file.originalName}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {file.mimeType}
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {formatSize(file.fileSize)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
        {file.viewCount} / {file.downloadCount}
      </td>
      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
        {formatDate(file.createdAt)}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <a
            href={`/f/${file.urlKey}`}
            target="_blank"
            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
          >
            预览
          </a>
          <button
            onClick={handleCopyLink}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            复制链接
          </button>
          <button
            onClick={handleDelete}
            className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            删除
          </button>
        </div>
      </td>
    </tr>
  );
}
