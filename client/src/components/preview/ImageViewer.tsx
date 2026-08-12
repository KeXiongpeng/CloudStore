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
