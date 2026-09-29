import { create } from 'zustand';
import { UploadItem, UploadItemStatus } from './types';

interface UploadState {
  items: UploadItem[];
  activeCount: number;
  maxActiveFiles: number;
  setStatus: (id: string, status: UploadItemStatus, patch?: Partial<UploadItem>) => void;
  updateProgress: (id: string, uploadedBytes: number, totalBytes: number) => void;
  enqueueFiles: (files: File[], workspaceId: string, folderId?: string) => void;
  retry: (id: string) => void;
  cancel: (id: string) => void;
  removeItem: (id: string) => void;
  clearCompleted: () => void;
}

function toItem(file: File, workspaceId: string, folderId?: string): UploadItem {
  const base = {
    id: crypto.randomUUID(),
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
    workspaceId,
    folderId,
    progress: 0,
    uploadedBytes: 0,
    attempt: 0,
  };

  // 空文件后端必定返回 400；这里直接进入失败状态，让用户看到明确原因。
  if (file.size === 0) {
    return {
      ...base,
      status: 'failed',
      error: '不能上传空文件',
    };
  }

  return {
    ...base,
    status: 'hashing',
  };
}

const AUTO_REMOVE_COMPLETED_MS = 3000;

export const useUploadQueue = create<UploadState>((set, get) => ({
  items: [],
  activeCount: 0,
  maxActiveFiles: 3,
  setStatus: (id, status, patch = {}) => {
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, status, ...patch } : item)),
    }));

    if (status === 'completed') {
      setTimeout(() => {
        if (useUploadQueue.getState().items.some((item) => item.id === id)) {
          get().removeItem(id);
        }
      }, AUTO_REMOVE_COMPLETED_MS);
    }
  },
  updateProgress: (id, uploadedBytes, totalBytes) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              uploadedBytes,
              progress: Math.min(99, Math.round((uploadedBytes / Math.max(totalBytes, 1)) * 100)),
            }
          : item,
      ),
    })),
  enqueueFiles: (files, workspaceId, folderId) =>
    set((state) => ({
      items: [
        ...state.items,
        ...Array.from(files).map((file) => toItem(file, workspaceId, folderId)),
      ],
    })),
  retry: (id) =>
    set((state) => ({
      items: state.items.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'hashing',
              error: undefined,
              progress: 0,
              uploadedBytes: 0,
              attempt: item.attempt + 1,
            }
          : item,
      ),
    })),
  cancel: (id) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, status: 'canceled' } : item)),
    })),
  removeItem: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
  clearCompleted: () =>
    set((state) => ({
      items: state.items.filter((item) => !['completed', 'canceled'].includes(item.status)),
    })),
}));
