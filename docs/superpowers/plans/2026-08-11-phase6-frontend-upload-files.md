# Phase 6: 前端上传 + 文件管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现完整的文件上传页面（拖拽上传 + 小文件直传 + 大文件分片中转）、文件管理页面（列表/网格视图 + 搜索 + 删除 + 复制链接）、Dashboard 页面（配额概览 + 统计）、API 密钥管理页面（创建/删除 + ShareX 配置导出）。

**Architecture:** 上传页使用 HTML5 Drag & Drop API 和 File API。小文件（≤5MB）走 Presigned URL 直传七牛云。大文件（>5MB）在前端分片后逐片 POST 到后端中转。文件管理页支持列表和网格两种视图模式。

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, TailwindCSS, Axios

## Global Constraints

- 前端: React + Next.js (App Router) + TailwindCSS + TypeScript
- 后端 API 基础路径: `/api`
- API 客户端: `client/src/lib/api.ts`（axios 实例）
- 认证: `useAuth()` hook + `AuthProvider`
- 布局: `(dashboard)` 路由组（Navbar + Sidebar）
- 上传阈值: ≤5MB 前端直传，>5MB 后端中转分片（每片 2MB）

## Prerequisites

Phase 1-5 必须已完成：前端脚手架、认证页面、布局组件。
后端 Phase 2-4 必须已完成：文件上传 API、文件管理 API、API 密钥 API。

---

## File Structure Overview

```
client/src/
├── lib/
│   └── upload.ts                # 上传工具函数（小文件直传 + 大文件分片）
├── hooks/
│   └── useUpload.ts             # 上传 Hook（管理上传状态和进度）
├── components/
│   ├── FileDropzone.tsx          # 拖拽上传区域组件
│   ├── UploadProgress.tsx        # 上传进度条组件
│   ├── FileCard.tsx              # 文件卡片组件（网格视图用）
│   ├── FileRow.tsx               # 文件行组件（列表视图用）
│   └── QuotaBar.tsx              # 配额进度条组件
├── app/
│   ├── (dashboard)/
│   │   ├── dashboard/page.tsx   # 修改：控制面板（配额概览 + 快速上传 + 统计）
│   │   ├── upload/page.tsx       # 修改：上传页（拖拽区域 + 上传列表）
│   │   ├── files/page.tsx        # 修改：文件管理（列表/网格 + 搜索 + 删除）
│   │   ├── api-keys/page.tsx     # 修改：API 密钥管理
│   │   └── settings/page.tsx     # 修改：个人设置（昵称/密码）
```

---

### Task 1: 上传工具函数 + useUpload Hook

**Files:**
- Create: `client/src/lib/upload.ts`
- Create: `client/src/hooks/useUpload.ts`

**Interfaces:**
- Produces: `uploadSmallFile(file)` — 小文件直传（获取 Presigned URL → PUT 七牛云 → 回调后端）
- Produces: `uploadLargeFile(file, onProgress)` — 大文件分片中转
- Produces: `uploadFile(file, onProgress)` — 自动判断大小，选择上传方式
- Produces: `useUpload()` — Hook，返回 `{ uploads, uploadFile, removeUpload, clearCompleted, isUploading }`

- [ ] **Step 1: 创建 `client/src/lib/upload.ts`**

```typescript
import api from './api';

const SMALL_FILE_THRESHOLD = 5 * 1024 * 1024; // 5MB
const PART_SIZE = 2 * 1024 * 1024; // 2MB per chunk

export async function uploadSmallFile(file: File): Promise<any> {
  // 1. 获取 Presigned URL
  const presignResponse = await api.post('/files/presign', {
    filename: file.name,
    contentType: file.type,
    fileSize: file.size,
  });

  const { uploadUrl, storageKey } = presignResponse.data;

  // 2. 直接 PUT 到七牛云
  await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type,
    },
  });

  // 3. 回调后端记录
  const callbackResponse = await api.post('/files/callback', {
    filename: file.name,
    contentType: file.type,
    fileSize: file.size,
    storageKey,
  });

  return callbackResponse.data;
}

export async function uploadLargeFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<any> {
  // 1. 初始化分片上传
  const initResponse = await api.post('/files/upload-init', {
    filename: file.name,
    contentType: file.type,
    totalSize: file.size,
  });

  const { uploadId, storageKey } = initResponse.data;

  // 2. 计算分片数
  const totalParts = Math.ceil(file.size / PART_SIZE);
  const parts: { partNumber: number; etag: string }[] = [];

  // 3. 逐片上传
  for (let i = 0; i < totalParts; i++) {
    const start = i * PART_SIZE;
    const end = Math.min(start + PART_SIZE, file.size);
    const blob = file.slice(start, end);

    const formData = new FormData();
    formData.append('file', blob);

    const partResponse = await api.post(
      `/files/upload-part?uploadId=${uploadId}&partNumber=${i + 1}`,
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      },
    );

    parts.push({
      partNumber: i + 1,
      etag: partResponse.data.etag,
    });

    // 更新进度
    if (onProgress) {
      const progress = Math.round(((i + 1) / totalParts) * 100);
      onProgress(progress);
    }
  }

  // 4. 完成合并
  const completeResponse = await api.post('/files/upload-complete', {
    uploadId,
    filename: file.name,
    contentType: file.type,
    totalSize: file.size,
    parts,
  });

  return completeResponse.data;
}

export async function uploadFile(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<any> {
  if (file.size <= SMALL_FILE_THRESHOLD) {
    // 小文件：直传，模拟两步进度
    if (onProgress) onProgress(30);
    const result = await uploadSmallFile(file);
    if (onProgress) onProgress(100);
    return result;
  } else {
    // 大文件：分片中转
    return uploadLargeFile(file, onProgress);
  }
}
```

- [ ] **Step 2: 创建 `client/src/hooks/useUpload.ts`**

```typescript
'use client';

import { useState, useCallback } from 'react';
import { uploadFile } from '@/lib/upload';

export interface UploadItem {
  id: string;
  file: File;
  progress: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  result?: any;
  error?: string;
}

export function useUpload() {
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  const uploadFiles = useCallback(async (files: File[]) => {
    const newItems: UploadItem[] = files.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      progress: 0,
      status: 'pending' as const,
    }));

    setUploads((prev) => [...prev, ...newItems]);

    for (const item of newItems) {
      setUploads((prev) =>
        prev.map((u) =>
          u.id === item.id ? { ...u, status: 'uploading' } : u,
        ),
      );

      try {
        const result = await uploadFile(item.file, (progress) => {
          setUploads((prev) =>
            prev.map((u) =>
              u.id === item.id ? { ...u, progress } : u,
            ),
          );
        });

        setUploads((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: 'success', result, progress: 100 } : u,
          ),
        );
      } catch (error: any) {
        const message = error.response?.data?.message || error.message || '上传失败';
        setUploads((prev) =>
          prev.map((u) =>
            u.id === item.id ? { ...u, status: 'error', error: message } : u,
          ),
        );
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
  };
}
```

- [ ] **Step 3: 提交**

```bash
git add client/
git commit -m "feat: add upload utility functions and useUpload hook"
```

---

### Task 2: 上传页面 — 拖拽区域 + 上传列表

**Files:**
- Create: `client/src/components/FileDropzone.tsx`
- Create: `client/src/components/UploadProgress.tsx`
- Modify: `client/src/app/(dashboard)/upload/page.tsx`

**Interfaces:**
- Consumes: `useUpload()` hook（Task 1）
- Produces: `/upload` — 完整上传页面，包含拖拽区域、文件列表、上传进度、完成后的链接复制

- [ ] **Step 1: 创建 `client/src/components/FileDropzone.tsx`**

```tsx
'use client';

import { useCallback, useState, useRef } from 'react';

interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  disabled?: boolean;
}

export default function FileDropzone({ onFilesSelected, disabled }: FileDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (disabled) return;

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        onFilesSelected(files);
      }
    },
    [disabled, onFilesSelected],
  );

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesSelected(files);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
        isDragging
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
          : 'border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={handleChange}
        className="hidden"
        disabled={disabled}
      />

      <svg
        className="mb-4 h-10 w-10 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
        />
      </svg>

      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {isDragging ? '释放文件以上传' : '拖拽文件到此处，或点击选择文件'}
      </p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        支持图片、视频、文档、压缩包等所有文件类型
      </p>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `client/src/components/UploadProgress.tsx`**

```tsx
'use client';

import type { UploadItem } from '@/hooks/useUpload';

interface UploadProgressProps {
  item: UploadItem;
  onRemove: (id: string) => void;
}

export default function UploadProgress({ item, onRemove }: UploadProgressProps) {
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const statusColor = {
    pending: 'text-gray-500',
    uploading: 'text-blue-500',
    success: 'text-green-500',
    error: 'text-red-500',
  };

  const statusText = {
    pending: '等待中',
    uploading: '上传中',
    success: '已完成',
    error: '失败',
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
            {item.file.name}
          </p>
          <div className="flex items-center gap-2 ml-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatSize(item.file.size)}
            </span>
            <span className={`text-xs font-medium ${statusColor[item.status]}`}>
              {statusText[item.status]}
            </span>
            <button
              onClick={() => onRemove(item.id)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              &times;
            </button>
          </div>
        </div>

        {item.status === 'uploading' && (
          <div className="mt-2 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}

        {item.status === 'success' && item.result && (
          <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
            链接：{window.location.origin}/f/{item.result.urlKey}
          </p>
        )}

        {item.status === 'error' && (
          <p className="mt-1 text-xs text-red-500">{item.error}</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 修改 `client/src/app/(dashboard)/upload/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
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
```

- [ ] **Step 4: 提交**

```bash
git add client/
git commit -m "feat: add upload page with drag-and-drop, progress tracking, and link display"
```

---

### Task 3: 文件管理页面 + Dashboard 配额概览

**Files:**
- Create: `client/src/components/FileRow.tsx`
- Create: `client/src/components/QuotaBar.tsx`
- Modify: `client/src/app/(dashboard)/files/page.tsx`
- Modify: `client/src/app/(dashboard)/dashboard/page.tsx`

**Interfaces:**
- Produces: `/files` — 文件管理页面（列表视图 + 搜索 + 删除 + 复制链接 + 分页）
- Produces: `/dashboard` — 控制面板（配额使用进度条 + 统计数据 + 快速上传入口）

- [ ] **Step 1: 创建 `client/src/components/QuotaBar.tsx`**

```tsx
'use client';

interface QuotaBarProps {
  used: number;
  limit: number;
}

export default function QuotaBar({ used, limit }: QuotaBarProps) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const barColor =
    percent >= 90
      ? 'bg-red-500'
      : percent >= 70
      ? 'bg-yellow-500'
      : 'bg-blue-500';

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">
          {formatSize(used)} / {formatSize(limit)}
        </span>
        <span className="font-medium text-gray-900 dark:text-white">
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `client/src/components/FileRow.tsx`**

```tsx
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
```

- [ ] **Step 3: 修改 `client/src/app/(dashboard)/files/page.tsx`**

```tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';
import FileRow from '@/components/FileRow';

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

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/files', { params: { page, limit } });
      setFiles(response.data.items);
      setTotal(response.data.total);
    } catch (error) {
      console.error('获取文件列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleDelete = async (fileId: string) => {
    try {
      await api.delete(`/files/${fileId}`);
      fetchFiles();
    } catch (error) {
      console.error('删除文件失败:', error);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">文件管理</h1>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          共 {total} 个文件
        </span>
      </div>

      {loading ? (
        <div className="mt-6 text-center text-gray-500 dark:text-gray-400">
          加载中...
        </div>
      ) : files.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-gray-500 dark:text-gray-400">还没有上传过文件</p>
          <a
            href="/upload"
            className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-500 dark:text-blue-400"
          >
            去上传
          </a>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    文件名
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    大小
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    浏览/下载
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    上传时间
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <FileRow key={file.id} file={file} onDelete={handleDelete} />
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
              >
                上一页
              </button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 修改 `client/src/app/(dashboard)/dashboard/page.tsx`**

```tsx
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
            <a href="/api-keys" className="text-xs text-blue-600 hover:text-blue-500 dark:text-blue-400">
              管理员切换等级
            </a>
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
```

- [ ] **Step 5: 提交**

```bash
git add client/
git commit -m "feat: add file management page, dashboard with quota/stats, and file row component"
```

---

### Task 4: API 密钥管理页面 + 个人设置页面

**Files:**
- Modify: `client/src/app/(dashboard)/api-keys/page.tsx`
- Modify: `client/src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Produces: `/api-keys` — API 密钥管理（创建、查看列表、删除、显示 ShareX 配置）
- Produces: `/settings` — 个人设置（修改昵称、修改密码）

- [ ] **Step 1: 修改 `client/src/app/(dashboard)/api-keys/page.tsx`**

```tsx
'use client';

import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

interface ApiKey {
  id: string;
  name: string;
  lastUsed: string | null;
  createdAt: string;
}

export default function ApiKeysPage() {
  const { user } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchKeys = async () => {
    const response = await api.get('/keys');
    setKeys(response.data);
  };

  useEffect(() => {
    fetchKeys();
  }, []);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;
    setLoading(true);
    try {
      const response = await api.post('/keys', { name: newKeyName });
      setCreatedKey(response.data.key);
      setNewKeyName('');
      fetchKeys();
    } catch (error) {
      console.error('创建密钥失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (keyId: string) => {
    if (!confirm('确定要删除此 API Key 吗？删除后使用此密钥的工具将无法上传。')) return;
    await api.delete(`/keys/${keyId}`);
    fetchKeys();
  };

  const sharexConfig = createdKey
    ? JSON.stringify({
        Name: 'CloudStore',
        RequestType: 'PUT',
        RequestURL: `${window.location.origin}/api/files/presign/api-key`,
        Headers: {
          'x-api-key': createdKey,
        },
        Body: '{{r:response.data.uploadUrl}}',
        FileFormName: 'file',
        URL: `${window.location.origin}/api/files/callback`,
        Arguments: {
          filename: '{filename}',
          contentType: '{filetype}',
          fileSize: '{filesize}',
          storageKey: '{response.data.storageKey}',
        },
        RequestMethod: 'POST',
      }, null, 2)
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">API 密钥</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        管理你的 API 密钥，用于 ShareX 等工具直接上传文件。
      </p>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">创建新密钥</h2>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="密钥名称（如 ShareX）"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            onClick={handleCreate}
            disabled={loading || !newKeyName.trim()}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            创建
          </button>
        </div>
      </div>

      {createdKey && (
        <div className="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
          <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            新密钥已生成（仅显示一次，请立即保存）
          </p>
          <div className="mt-2 rounded bg-white p-3 font-mono text-sm dark:bg-gray-900">
            {createdKey}
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(createdKey);
            }}
            className="mt-2 rounded bg-yellow-600 px-3 py-1 text-sm text-white hover:bg-yellow-700"
          >
            复制密钥
          </button>

          {sharexConfig && (
            <div className="mt-4">
              <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">ShareX 配置</p>
              <button
                onClick={() => navigator.clipboard.writeText(sharexConfig)}
                className="mt-1 rounded bg-gray-100 px-3 py-1 text-sm dark:bg-gray-800 dark:text-gray-300"
              >
                复制 ShareX JSON 配置
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">已有密钥</h2>
        {keys.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">暂无 API 密钥</p>
        ) : (
          <div className="mt-3 space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{key.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    创建于 {new Date(key.createdAt).toLocaleDateString('zh-CN')}
                    {key.lastUsed && ` · 最后使用 ${new Date(key.lastUsed).toLocaleDateString('zh-CN')}`}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(key.id)}
                  className="text-sm text-red-600 hover:text-red-700 dark:text-red-400"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 修改 `client/src/app/(dashboard)/settings/page.tsx`**

```tsx
'use client';

import { useState } from 'react';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // 密码修改
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      await api.patch('/users/me', { nickname });
      await refreshUser();
      setMessage('昵称已更新');
    } catch (err: any) {
      setError(err.response?.data?.message || '更新失败');
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (newPassword !== confirmNewPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    if (newPassword.length < 6) {
      setError('新密码至少 6 个字符');
      return;
    }

    try {
      await api.patch('/users/me/password', {
        oldPassword,
        newPassword,
      });
      setMessage('密码已修改');
      setOldPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err: any) {
      setError(err.response?.data?.message || '密码修改失败');
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">个人设置</h1>

      {message && (
        <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-600 dark:bg-green-900/30 dark:text-green-400">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">个人信息</h2>
        <form onSubmit={handleUpdateProfile} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400">邮箱</label>
            <input
              type="email"
              value={user?.email || ''}
              disabled
              className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400">昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            保存
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">修改密码</h2>
        <form onSubmit={handleUpdatePassword} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400">当前密码</label>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400">新密码</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400">确认新密码</label>
            <input
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              required
              minLength={6}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            />
          </div>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            修改密码
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add client/
git commit -m "feat: add API keys management page and user settings page"
```

---

## 验证清单

完成所有 Task 后，执行以下验证：

1. **验证上传页面：**
   - 登录后访问 `/upload`
   - 拖拽一个小文件（< 5MB）到上传区域
   - 预期：显示上传进度，完成后显示文件链接

2. **验证文件管理页面：**
   - 访问 `/files`
   - 预期：显示文件列表，包含文件名、大小、浏览/下载次数、上传时间
   - 预期：点击"复制链接"可以复制文件 URL
   - 预期：点击"删除"可以删除文件

3. **验证 Dashboard 配额：**
   - 访问 `/dashboard`
   - 预期：显示存储空间进度条、文件总数、浏览量、下载量

4. **验证 API 密钥：**
   - 访问 `/api-keys`
   - 创建一个名为 "ShareX" 的密钥
   - 预期：显示密钥明文和 ShareX 配置

5. **验证个人设置：**
   - 访问 `/settings`
   - 修改昵称
   - 预期：修改成功，顶部导航栏显示新昵称

6. **验证大文件分片上传：**
   - 上传一个大于 5MB 的文件
   - 预期：显示逐片上传进度，最终完成并返回链接
