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
  storageKey: string;
  fileUrl: string;
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
  const contentUrl = `/api/public/files/${file.urlKey}/content`;

  useEffect(() => {
    api.post(`/public/files/${file.urlKey}/view`).catch(() => {});
  }, [file.urlKey]);

  const renderPreview = () => {
    const { mimeType } = file;

    if (mimeType.startsWith('image/')) {
      return <ImageViewer fileUrl={contentUrl} fileName={file.originalName} />;
    }

    if (mimeType.startsWith('video/')) {
      return <VideoPlayer fileUrl={contentUrl} fileName={file.originalName} />;
    }

    if (mimeType.startsWith('audio/')) {
      return <AudioPlayer fileUrl={contentUrl} fileName={file.originalName} />;
    }

    if (mimeType === 'application/pdf') {
      return <PdfViewer fileUrl={contentUrl} fileName={file.originalName} />;
    }

    if (
      mimeType.startsWith('text/') ||
      mimeType === 'application/json' ||
      mimeType === 'application/xml' ||
      mimeType.includes('javascript')
    ) {
      return <CodeViewer fileUrl={contentUrl} fileName={file.originalName} mimeType={mimeType} />;
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
