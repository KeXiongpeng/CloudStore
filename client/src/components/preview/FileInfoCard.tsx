'use client';

interface FileInfoCardProps {
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadTime: string;
  uploaderName: string;
  viewCount: number;
  downloadCount: number;
  downloadUrl: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('7z') || mimeType.includes('rar')) return '📦';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑';
  return '📎';
}

export default function FileInfoCard({
  fileName,
  fileSize,
  mimeType,
  uploadTime,
  uploaderName,
  viewCount,
  downloadCount,
  downloadUrl,
}: FileInfoCardProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <span className="text-6xl">{getFileIcon(mimeType)}</span>
      <p className="mt-4 text-lg font-medium text-gray-900 dark:text-white">{fileName}</p>
      <div className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        <p>{mimeType} · {formatSize(fileSize)}</p>
      </div>
      <div className="mt-6">
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          下载文件
        </a>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-2 text-center text-xs text-gray-500 dark:text-gray-400">
        <p>浏览 {viewCount} 次</p>
        <p>下载 {downloadCount} 次</p>
        <p>上传于 {new Date(uploadTime).toLocaleDateString('zh-CN')}</p>
        <p>上传者 {uploaderName}</p>
      </div>
    </div>
  );
}
