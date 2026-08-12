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
