'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import QuotaBar from '@/components/QuotaBar';

export default function DashboardPage() {
  const [quota, setQuota] = useState<{ storageLimit: number; storageUsed: number; tier: string } | null>(null);
  const [stats, setStats] = useState<{ totalFiles: number; totalViews: number; totalDownloads: number; totalSize: number } | null>(null);

  useEffect(() => {
    Promise.all([
      api.get('/users/me/quota'),
      api.get('/files/stats'),
    ]).then(([quotaRes, statsRes]) => {
      setQuota(quotaRes.data);
      setStats(statsRes.data);
    }).catch(console.error);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">控制面板</h1>

      {quota && (
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              存储空间 ({quota.tier.toUpperCase()})
            </h2>
          </div>
          <div className="mt-4">
            <QuotaBar used={quota.storageUsed} limit={quota.storageLimit} />
          </div>
        </div>
      )}

      {stats && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">文件总数</p>
            <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">
              {stats.totalFiles}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">总浏览量</p>
            <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">
              {stats.totalViews}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
            <p className="text-sm text-gray-500 dark:text-gray-400">总下载量</p>
            <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">
              {stats.totalDownloads}
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 flex gap-4">
        <Link
          href="/upload"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          上传文件
        </Link>
        <Link
          href="/files"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300"
        >
          文件管理
        </Link>
      </div>
    </div>
  );
}
