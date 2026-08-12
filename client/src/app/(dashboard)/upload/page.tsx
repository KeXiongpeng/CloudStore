'use client';

import FileDropzone from '@/components/FileDropzone';
import UploadProgress from '@/components/UploadProgress';
import { useUpload } from '@/hooks/useUpload';

export default function UploadPage() {
  const { uploads, uploadFiles, removeUpload, clearCompleted, isUploading, notifications } = useUpload();

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">上传文件</h1>
        {uploads.some((u) => u.status === 'success') && (
          <button
            onClick={clearCompleted}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
          >
            清除已完成
          </button>
        )}
      </div>

      <div className="mt-6">
        <FileDropzone onFilesSelected={uploadFiles} disabled={isUploading} />
      </div>

      {uploads.length > 0 && (
        <div className="mt-6 space-y-2">
          <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            上传列表 ({uploads.length})
          </h2>
          {uploads.map((item) => (
            <UploadProgress key={item.id} item={item} onRemove={removeUpload} />
          ))}
        </div>
      )}

      {notifications.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg transition-all animate-[slideIn_0.3s_ease-out] ${
                n.type === 'success'
                  ? 'bg-green-500 text-white'
                  : 'bg-red-500 text-white'
              }`}
            >
              {n.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
