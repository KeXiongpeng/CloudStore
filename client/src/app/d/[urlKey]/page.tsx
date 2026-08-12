'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';

export default function DownloadPage() {
  const params = useParams();
  const urlKey = params.urlKey as string;
  const [error, setError] = useState(false);

  useEffect(() => {
    api.get(`/public/files/${urlKey}/download`)
      .then((res) => {
        const downloadUrl = res.data.downloadUrl;
        if (downloadUrl) {
          window.location.href = downloadUrl;
        }
      })
      .catch(() => setError(true));
  }, [urlKey]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">404</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">文件不存在或已删除</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500 dark:text-gray-400">正在准备下载...</p>
    </div>
  );
}
