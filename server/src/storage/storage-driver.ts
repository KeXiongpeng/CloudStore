export interface DirectPutUrlInput {
  key: string;
  contentType: string;
  expiresInSeconds: number;
}

export interface CreateMultipartInput {
  key: string;
  contentType: string;
}

export interface PartPutUrlInput {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds: number;
}

export interface CompleteMultipartInput {
  key: string;
  uploadId: string;
  parts: { partNumber: number; etag: string }[];
}

export interface AbortMultipartInput {
  key: string;
  uploadId: string;
}

export interface HeadObjectResult {
  key: string;
  size: number;
  contentType?: string;
  etag?: string;
}

export interface StorageDriver {
  readonly name: 'minio' | 'qiniu';
  getObjectForProcessing(key: string): Promise<Buffer>;
  putProcessedObject(key: string, body: Buffer, contentType: string): Promise<void>;
  createDirectPutUrl(input: DirectPutUrlInput): Promise<string>;
  headObject(key: string): Promise<HeadObjectResult | null>;
  createMultipart(input: CreateMultipartInput): Promise<{ uploadId: string }>;
  createPartPutUrl(input: PartPutUrlInput): Promise<string>;
  completeMultipart(input: CompleteMultipartInput): Promise<{ key: string; etag?: string }>;
  abortMultipart(input: AbortMultipartInput): Promise<void>;
  deleteObject(key: string): Promise<void>;
}
