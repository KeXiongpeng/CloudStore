'use client';

import FileDropzone from '@/components/FileDropzone';
import UploadProgress from '@/components/UploadProgress';
import { useUpload } from '@/hooks/useUpload';

export default function UploadPage() {
  const { uploads, uploadFiles, removeUpload, clearCompleted, isUploading } = useUpload();

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
    </div>
  );
}
