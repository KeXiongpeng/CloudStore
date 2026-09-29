export type UploadItemStatus =
  | 'hashing'
  | 'creating'
  | 'instant'
  | 'uploading'
  | 'merging'
  | 'completed'
  | 'canceled'
  | 'failed';

export interface UploadItem {
  id: string;
  file: File;
  relativePath?: string;
  workspaceId: string;
  folderId?: string;
  status: UploadItemStatus;
  progress: number;
  uploadedBytes: number;
  hash?: string;
  uploadSessionId?: string;
  missingChunks?: number[];
  error?: string;
  attempt: number;
}
