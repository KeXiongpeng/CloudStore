'use client';

import { useState, useCallback } from 'react';
import { uploadFile, UploadedFile } from '@/lib/upload';
import { getApiErrorMessage } from '@/lib/errors';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  result?: UploadedFile;
  error?: string;
}

export interface UploadNotification {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export function useUpload() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [notifications, setNotifications] = useState<UploadNotification[]>([]);

  const addNotification = (message: string, type: 'success' | 'error') => {
    const id = `${Date.now()}`;
    setNotifications((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 3000);
  };

  const uploadFiles = useCallback(async (files: File[]) => {
    const newItems: UploadItem[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      progress: 0,
      status: 'pending' as const,
    }));

    setUploads((prev) => [...prev, ...newItems]);

    for (const item of newItems) {
      setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, status: 'uploading' } : u)));

      try {
        const result = await uploadFile(item.file, (progress) => {
          setUploads((prev) => prev.map((u) => (u.id === item.id ? { ...u, progress } : u)));
        });

        setUploads((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: 'success', result, progress: 100 } : u,
          ),
        );

        addNotification(`${item.file.name} 上传成功`, 'success');
      } catch (error: unknown) {
        const message = getApiErrorMessage(error, '上传失败');
        setUploads((prev) =>
          prev.map((u) => (u.id === item.id ? { ...u, status: 'error', error: message } : u)),
        );

        addNotification(`${item.file.name} 上传失败`, 'error');
      }
    }
  }, []);

  const removeUpload = useCallback((id: string) => {
    setUploads((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== 'success'));
  }, []);

  const isUploading = uploads.some((u) => u.status === 'uploading');

  return {
    uploads,
    uploadFiles,
    removeUpload,
    clearCompleted,
    isUploading,
    notifications,
  };
}
