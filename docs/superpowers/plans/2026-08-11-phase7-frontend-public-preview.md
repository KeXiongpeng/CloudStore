# Phase 7: 前端公共预览页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现公共文件预览页面——任何人打开 `/f/:urlKey` 链接即可在线预览文件（图片/视频/音频/PDF/代码/文本）并下载，无需登录。支持嵌入模式（iframe 无框架渲染）和 SEO 元数据。

**Architecture:** `/f/[urlKey]/page.tsx` 是一个 Server Component，通过后端公共 API 获取文件元数据。根据 MIME 类型动态渲染对应的预览组件。预览组件均为 Client Component。操作栏提供下载、复制链接、分享二维码功能。

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, TailwindCSS

## Global Constraints

- 前端: React + Next.js (App Router) + TailwindCSS + TypeScript
- 后端 API: `GET /api/public/files/:urlKey`（无需鉴权）
- 后端 API: `GET /api/public/files/:urlKey/download`（重定向到七牛云下载 URL）
- 后端 API: `POST /api/public/files/:urlKey/view`（记录浏览）
- 文件访问 URL 格式: `/f/:urlKey`

## Prerequisites

Phase 1-6 必须已完成。后端 Phase 4 的公共接口必须可用。

---

## File Structure Overview

```
client/src/
├── app/
│   ├── f/
│   │   └── [urlKey]/
│   │       ├── page.tsx              # 文件预览页（Server Component）
│   │       └── embed/
│   │           └── page.tsx          # 嵌入模式（无页面框架）
│   └── d/
│       └── [urlKey]/
│           └── page.tsx              # 直接下载跳转页
├── components/
│   ├── preview/
│   │   ├── ImageViewer.tsx           # 图片查看器
│   │   ├── VideoPlayer.tsx           # 视频播放器
│   │   ├── AudioPlayer.tsx           # 音频播放器
│   │   ├── PdfViewer.tsx             # PDF 阅读器
│   │   ├── CodeViewer.tsx            # 代码/文本查看器
│   │   └── FileInfoCard.tsx         # 通用文件信息卡（不可预览的类型）
│   ├── PreviewToolbar.tsx            # 预览操作栏（下载、复制、二维码）
│   └── QrCodeDialog.tsx             # 二维码弹窗
```

---

### Task 1: 预览组件 — ImageViewer, VideoPlayer, AudioPlayer, PdfViewer, CodeViewer, FileInfoCard

**Files:**

- Create: `client/src/components/preview/ImageViewer.tsx`
- Create: `client/src/components/preview/VideoPlayer.tsx`
- Create: `client/src/components/preview/AudioPlayer.tsx`
- Create: `client/src/components/preview/PdfViewer.tsx`
- Create: `client/src/components/preview/CodeViewer.tsx`
- Create: `client/src/components/preview/FileInfoCard.tsx`

**Interfaces:**

- Consumes: `fileUrl` (七牛云文件直链)、`fileName`、`mimeType`
- Produces: 各组件根据 MIME 类型渲染对应的内容查看器

- [ ] **Step 1: 创建 `client/src/components/preview/ImageViewer.tsx`**

```tsx
'use client';

import { useState } from 'react';

interface ImageViewerProps {
  fileUrl: string;
  fileName: string;
}

export default function ImageViewer({ fileUrl, fileName }: ImageViewerProps) {
  const [zoomed, setZoomed] = useState(false);

  return (
    <div className="flex items-center justify-center bg-gray-100 dark:bg-gray-800">
      <img
        src={fileUrl}
        alt={fileName}
        onClick={() => setZoomed(!zoomed)}
        className={`max-h-[75vh] transition-transform ${
          zoomed ? 'cursor-zoom-out scale-150' : 'cursor-zoom-in'
        }`}
      />
    </div>
  );
}
```

- [ ] **Step 2: 创建 `client/src/components/preview/VideoPlayer.tsx`**

```tsx
'use client';

interface VideoPlayerProps {
  fileUrl: string;
  fileName: string;
}

export default function VideoPlayer({ fileUrl, fileName }: VideoPlayerProps) {
  return (
    <div className="flex items-center justify-center bg-black">
      <video controls autoPlay className="max-h-[75vh] w-full" preload="metadata">
        <source src={fileUrl} />
        你的浏览器不支持视频播放
      </video>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `client/src/components/preview/AudioPlayer.tsx`**

```tsx
'use client';

interface AudioPlayerProps {
  fileUrl: string;
  fileName: string;
}

export default function AudioPlayer({ fileUrl, fileName }: AudioPlayerProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <svg
        className="mb-6 h-24 w-24 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
        />
      </svg>
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">{fileName}</p>
      <audio controls autoPlay className="w-full max-w-md">
        <source src={fileUrl} />
        你的浏览器不支持音频播放
      </audio>
    </div>
  );
}
```

- [ ] **Step 4: 创建 `client/src/components/preview/PdfViewer.tsx`**

```tsx
'use client';

interface PdfViewerProps {
  fileUrl: string;
  fileName: string;
}

export default function PdfViewer({ fileUrl, fileName }: PdfViewerProps) {
  return (
    <div className="h-[75vh] w-full">
      <iframe src={fileUrl} title={fileName} className="h-full w-full border-0" />
    </div>
  );
}
```

- [ ] **Step 5: 创建 `client/src/components/preview/CodeViewer.tsx`**

```tsx
'use client';

interface CodeViewerProps {
  fileUrl: string;
  fileName: string;
  mimeType: string;
}

export default function CodeViewer({ fileUrl, fileName, mimeType }: CodeViewerProps) {
  return (
    <div className="h-[75vh] w-full">
      <iframe
        src={fileUrl}
        title={fileName}
        className="h-full w-full rounded border border-gray-200 bg-white dark:border-gray-700"
      />
    </div>
  );
}
```

- [ ] **Step 6: 创建 `client/src/components/preview/FileInfoCard.tsx`**

```tsx
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
  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('7z') ||
    mimeType.includes('rar')
  )
    return '📦';
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
        <p>
          {mimeType} · {formatSize(fileSize)}
        </p>
      </div>
      <div className="mt-6">
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
            />
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
```

- [ ] **Step 7: 提交**

```bash
git add client/
git commit -m "feat: add preview components for image, video, audio, PDF, code, and generic file"
```

---

### Task 2: 预览操作栏 + 二维码弹窗

**Files:**

- Create: `client/src/components/PreviewToolbar.tsx`
- Create: `client/src/components/QrCodeDialog.tsx`

**Interfaces:**

- Produces: `PreviewToolbar` — 预览页顶部/底部操作栏（下载、复制链接、二维码、文件信息）
- Produces: `QrCodeDialog` — 二维码弹窗组件

- [ ] **Step 1: 创建 `client/src/components/QrCodeDialog.tsx`**

```tsx
'use client';

import { useState, useEffect, useRef } from 'react';

interface QrCodeDialogProps {
  url: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function QrCodeDialog({ url, isOpen, onClose }: QrCodeDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="rounded-lg bg-white p-6 text-center shadow-lg dark:bg-gray-900">
        <h3 className="text-lg font-medium text-gray-900 dark:text-white">分享二维码</h3>
        <img src={qrCodeUrl} alt="QR Code" className="mx-auto mt-4 h-48 w-48" />
        <p className="mt-2 break-all text-xs text-gray-500 dark:text-gray-400">{url}</p>
        <button
          onClick={onClose}
          className="mt-4 rounded-md bg-gray-100 px-4 py-2 text-sm text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `client/src/components/PreviewToolbar.tsx`**

```tsx
'use client';

import { useState } from 'react';
import QrCodeDialog from './QrCodeDialog';

interface PreviewToolbarProps {
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadTime: string;
  uploaderName: string;
  viewCount: number;
  downloadCount: number;
}

export default function PreviewToolbar({
  fileUrl,
  fileName,
  fileSize,
  mimeType,
  uploadTime,
  uploaderName,
  viewCount,
  downloadCount,
}: PreviewToolbarProps) {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(fileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-center gap-3">
          <p
            className="truncate text-sm font-medium text-gray-900 dark:text-white"
            title={fileName}
          >
            {fileName}
          </p>
          <span className="text-xs text-gray-400">
            {formatSize(fileSize)} · {viewCount} 次浏览 · {downloadCount} 次下载
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleCopy}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            title="复制链接"
          >
            {copied ? '已复制' : '复制链接'}
          </button>
          <button
            onClick={() => setShowQr(true)}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            title="二维码"
          >
            二维码
          </button>
          <a
            href={`/d/${fileUrl.split('/').pop()}`}
            className="rounded px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
            title="下载"
          >
            下载
          </a>
          <button
            onClick={() => setShowInfo(!showInfo)}
            className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            详情
          </button>
        </div>
      </div>

      {showInfo && (
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-4">
            <p>类型: {mimeType}</p>
            <p>大小: {formatSize(fileSize)}</p>
            <p>上传: {new Date(uploadTime).toLocaleDateString('zh-CN')}</p>
            <p>上传者: {uploaderName}</p>
          </div>
        </div>
      )}

      <QrCodeDialog url={fileUrl} isOpen={showQr} onClose={() => setShowQr(false)} />
    </>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add client/
git commit -m "feat: add preview toolbar and QR code dialog"
```

---

### Task 3: 文件预览页 + 嵌入模式 + 直接下载页

**Files:**

- Create: `client/src/app/f/[urlKey]/page.tsx`（文件预览页）
- Create: `client/src/app/f/[urlKey]/embed/page.tsx`（嵌入模式）
- Create: `client/src/app/d/[urlKey]/page.tsx`（直接下载跳转）

**Interfaces:**

- Consumes: `GET /api/public/files/:urlKey`（获取文件元数据）
- Consumes: 所有预览组件（Task 1）
- Consumes: `PreviewToolbar`（Task 2）
- Produces: `/f/:urlKey` — 完整预览页面（工具栏 + 预览组件）
- Produces: `/f/:urlKey?embed=true` — 嵌入模式（无工具栏，纯预览）
- Produces: `/d/:urlKey` — 直接下载跳转

- [ ] **Step 1: 创建 `client/src/app/f/[urlKey]/page.tsx`**

```tsx
import { Metadata } from 'next';
import api from '@/lib/api';
import PreviewPageClient from './PreviewPageClient';

interface Props {
  params: Promise<{ urlKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { urlKey } = await params;

  try {
    const response = await api.get(`/public/files/${urlKey}`, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const file = response.data;

    const title = `${file.originalName} - CloudStore`;

    if (file.mimeType.startsWith('image/')) {
      return {
        title,
        openGraph: {
          title: file.originalName,
          images: [file.fileUrl || ''],
          type: 'image',
        },
      };
    }

    if (file.mimeType.startsWith('video/')) {
      return {
        title,
        openGraph: {
          title: file.originalName,
          type: 'video.other',
          videos: [file.fileUrl || ''],
        },
      };
    }

    return {
      title,
      openGraph: {
        title: file.originalName,
        description: `${file.mimeType} · 文件分享`,
      },
    };
  } catch {
    return { title: '文件未找到 - CloudStore' };
  }
}

export default async function FilePreviewPage({ params }: Props) {
  const { urlKey } = await params;

  try {
    const response = await api.get(`/public/files/${urlKey}`);
    const file = response.data;

    return <PreviewPageClient file={file} />;
  } catch {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">404</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">文件不存在或已删除</p>
        </div>
      </div>
    );
  }
}
```

- [ ] **Step 2: 创建 `client/src/app/f/[urlKey]/PreviewPageClient.tsx`**

```tsx
'use client';

import { useEffect } from 'react';
import api from '@/lib/api';
import PreviewToolbar from '@/components/PreviewToolbar';
import ImageViewer from '@/components/preview/ImageViewer';
import VideoPlayer from '@/components/preview/VideoPlayer';
import AudioPlayer from '@/components/preview/AudioPlayer';
import PdfViewer from '@/components/preview/PdfViewer';
import CodeViewer from '@/components/preview/CodeViewer';
import FileInfoCard from '@/components/preview/FileInfoCard';

interface FileData {
  id: string;
  originalName: string;
  urlKey: string;
  fileSize: number;
  mimeType: string;
  viewCount: number;
  downloadCount: number;
  createdAt: string;
  user: {
    nickname: string;
  };
}

interface Props {
  file: FileData;
}

export default function PreviewPageClient({ file }: Props) {
  const pageUrl = `${window.location.origin}/f/${file.urlKey}`;
  const downloadUrl = `${window.location.origin}/d/${file.urlKey}`;

  // 异步记录浏览（不影响页面渲染）
  useEffect(() => {
    api.post(`/public/files/${file.urlKey}/view`).catch(() => {});
  }, [file.urlKey]);

  const renderPreview = () => {
    const { mimeType } = file;

    if (mimeType.startsWith('image/')) {
      return <ImageViewer fileUrl={pageUrl} fileName={file.originalName} />;
    }

    if (mimeType.startsWith('video/')) {
      return <VideoPlayer fileUrl={pageUrl} fileName={file.originalName} />;
    }

    if (mimeType.startsWith('audio/')) {
      return <AudioPlayer fileUrl={pageUrl} fileName={file.originalName} />;
    }

    if (mimeType === 'application/pdf') {
      return <PdfViewer fileUrl={pageUrl} fileName={file.originalName} />;
    }

    if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/xml' ||
      mimeType.includes('javascript')
    ) {
      return <CodeViewer fileUrl={pageUrl} fileName={file.originalName} mimeType={mimeType} />;
    }

    return (
      <FileInfoCard
        fileName={file.originalName}
        fileSize={file.fileSize}
        mimeType={file.mimeType}
        uploadTime={file.createdAt}
        uploaderName={file.user?.nickname || '匿名'}
        viewCount={file.viewCount}
        downloadCount={file.downloadCount}
        downloadUrl={downloadUrl}
      />
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-gray-950">
      <PreviewToolbar
        fileUrl={pageUrl}
        fileName={file.originalName}
        fileSize={file.fileSize}
        mimeType={file.mimeType}
        uploadTime={file.createdAt}
        uploaderName={file.user?.nickname || '匿名'}
        viewCount={file.viewCount}
        downloadCount={file.downloadCount}
      />
      <div className="flex-1">{renderPreview()}</div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `client/src/app/f/[urlKey]/embed/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';
import ImageViewer from '@/components/preview/ImageViewer';
import VideoPlayer from '@/components/preview/VideoPlayer';
import AudioPlayer from '@/components/preview/AudioPlayer';
import PdfViewer from '@/components/preview/PdfViewer';

export default function EmbedPage() {
  const params = useParams();
  const urlKey = params.urlKey as string;
  const [file, setFile] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get(`/public/files/${urlKey}`)
      .then((res) => setFile(res.data))
      .catch(() => setError(true));
  }, [urlKey]);

  if (error || !file) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p>文件不存在或已删除</p>
      </div>
    );
  }

  const pageUrl = `${window.location.origin}/f/${file.urlKey}`;
  const { mimeType } = file;

  if (mimeType.startsWith('image/')) {
    return <ImageViewer fileUrl={pageUrl} fileName={file.originalName} />;
  }
  if (mimeType.startsWith('video/')) {
    return <VideoPlayer fileUrl={pageUrl} fileName={file.originalName} />;
  }
  if (mimeType.startsWith('audio/')) {
    return <AudioPlayer fileUrl={pageUrl} fileName={file.originalName} />;
  }
  if (mimeType === 'application/pdf') {
    return <PdfViewer fileUrl={pageUrl} fileName={file.originalName} />;
  }

  return <div className="p-4 text-white">此文件类型不支持嵌入预览</div>;
}
```

- [ ] **Step 4: 创建 `client/src/app/d/[urlKey]/page.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';

export default function DownloadPage() {
  const params = useParams();
  const urlKey = params.urlKey as string;
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get(`/public/files/${urlKey}/download`)
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
```

- [ ] **Step 5: 提交**

```bash
git add client/
git commit -m "feat: add file preview page, embed mode, and direct download page"
```

---

## 验证清单

完成所有 Task 后，执行以下验证：

1. **验证文件预览（图片）：**
   - 上传一张图片，获得链接（如 `/f/photo.jpg`）
   - 在浏览器中打开
   - 预期：显示图片查看器，支持点击缩放
   - 预期：工具栏显示文件名、大小、浏览次数、下载按钮

2. **验证文件预览（视频）：**
   - 上传一个视频文件
   - 打开预览链接
   - 预期：显示视频播放器，自动播放

3. **验证文件预览（不可预览类型）：**
   - 上传一个 .zip 文件
   - 打开预览链接
   - 预期：显示文件图标 + 文件信息 + 下载按钮

4. **验证复制链接：**
   - 在预览页点击"复制链接"
   - 预期：显示"已复制"，链接在剪贴板中

5. **验证二维码：**
   - 在预览页点击"二维码"
   - 预期：弹出二维码弹窗

6. **验证下载：**
   - 点击"下载"按钮
   - 预期：跳转到 `/d/:urlKey`，自动下载文件

7. **验证 404：**
   - 访问 `/f/nonexistent-file.jpg`
   - 预期：显示"文件不存在或已删除"

8. **验证 SEO 元数据：**
   - 查看页面 `<head>` 中 `<title>` 是否为 "文件名 - CloudStore"
   - 预期：包含正确的文件名

9. **验证嵌入模式：**
   - 访问 `/f/photo.jpg?embed=true`
   - 预期：仅显示图片，无工具栏
