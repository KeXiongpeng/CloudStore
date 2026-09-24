import { S3Client } from '@aws-sdk/client-s3';
import { BaseS3StorageDriver } from './base-s3-storage.driver';

export interface MinioStorageDriverOptions {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export class MinioStorageDriver extends BaseS3StorageDriver {
  readonly name = 'minio' as const;

  constructor(options: MinioStorageDriverOptions) {
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
