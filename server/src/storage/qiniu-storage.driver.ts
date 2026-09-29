import { S3Client } from '@aws-sdk/client-s3';
import { BaseS3StorageDriver } from './base-s3-storage.driver';

export interface QiniuStorageDriverOptions {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export class QiniuStorageDriver extends BaseS3StorageDriver {
  readonly name = 'qiniu' as const;

  constructor(options: QiniuStorageDriverOptions) {
    super(
      new S3Client({
        region: options.region,
        endpoint: options.endpoint,
        credentials: {
          accessKeyId: options.accessKey,
          secretAccessKey: options.secretKey,
        },
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      }),
      options.bucket,
    );
  }
}
