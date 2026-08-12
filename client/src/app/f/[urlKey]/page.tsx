import { Metadata } from 'next';
import api from '@/lib/api';
import PreviewPageClient from './PreviewPageClient';

interface Props {
  params: Promise<{ urlKey: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { urlKey } = await params;

  try {
    const response = await api.get(`/public/files/${urlKey}`);
    const file = response.data;

    const title = `${file.originalName} - CloudStore`;

    if (file.mimeType.startsWith('image/')) {
      return {
        title,
        openGraph: {
          title: file.originalName,
          images: [{ url: `/api/public/files/${urlKey}/download` }],
        },
      };
    }

    if (file.mimeType.startsWith('video/')) {
      return {
        title,
        openGraph: {
          title: file.originalName,
          type: 'video.other',
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
