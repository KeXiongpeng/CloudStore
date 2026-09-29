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
