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
  return {
    id: crypto.randomUUID(),
    file,
    relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
    workspaceId,
    folderId,
    status: 'hashing',
    progress: 0,
    uploadedBytes: 0,
    attempt: 0,
  };
}

export const useUploadQueue = create<UploadState>((set) => ({
  items: [],
  activeCount: 0,
  maxActiveFiles: 3,
  setStatus: (id, status, patch = {}) =>
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? { ...item, status, ...patch } : item)),
    })),
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
