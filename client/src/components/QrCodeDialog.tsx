'use client';

import { useEffect, useRef } from 'react';

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
