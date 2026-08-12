'use client';

interface VideoPlayerProps {
  fileUrl: string;
  fileName: string;
}

export default function VideoPlayer({ fileUrl, fileName }: VideoPlayerProps) {
  return (
    <div className="flex items-center justify-center bg-black">
      <video
        controls
        className="max-h-[75vh] w-full"
        preload="metadata"
      >
        <source src={fileUrl} />
        你的浏览器不支持视频播放
      </video>
    </div>
  );
}
