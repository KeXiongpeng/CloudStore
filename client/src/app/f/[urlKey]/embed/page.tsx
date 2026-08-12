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
    api.get(`/public/files/${urlKey}`)
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
