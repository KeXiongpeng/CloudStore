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
      <audio controls className="w-full max-w-md">
        <source src={fileUrl} />
        你的浏览器不支持音频播放
      </audio>
    </div>
  );
}
