import { S3Client } from '@aws-sdk/client-s3';
import { BaseS3StorageDriver } from './base-s3-storage.driver';

export interface MinioStorageDriverOptions {
  endpoint: string;
  region: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  /** Browser-reachable endpoint used only to sign URLs; omitted means endpoint. */
  publicEndpoint?: string;
}

export class MinioStorageDriver extends BaseS3StorageDriver {
  readonly name = 'minio' as const;

  constructor(options: MinioStorageDriverOptions) {
    const client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      credentials: {
        accessKeyId: options.accessKey,
        secretAccessKey: options.secretKey,
      },
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    const presignClient = options.publicEndpoint
      ? new S3Client({
          region: options.region,
          endpoint: options.publicEndpoint,
          credentials: {
            accessKeyId: options.accessKey,
            secretAccessKey: options.secretKey,
          },
          forcePathStyle: true,
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        })
      : client;

    super(client, options.bucket, presignClient);
  }
}
