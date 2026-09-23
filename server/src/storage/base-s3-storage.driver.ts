import {
  AbortMultipartUploadCommand,
  GetObjectCommandOutput,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AbortMultipartInput,
  CompleteMultipartInput,
  CreateMultipartInput,
  DirectPutUrlInput,
  HeadObjectResult,
  PartPutUrlInput,
  StorageDriver,
} from './storage-driver';

export abstract class BaseS3StorageDriver implements StorageDriver {
  abstract readonly name: 'minio' | 'qiniu';

  protected constructor(
    protected readonly client: S3Client,
    protected readonly bucket: string,
  ) {}

  protected presignPut(command: PutObjectCommand, expiresInSeconds: number) {
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  protected presignUploadPart(command: UploadPartCommand, expiresInSeconds: number) {
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async createDirectPutUrl(input: DirectPutUrlInput): Promise<string> {
    return this.presignPut(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      input.expiresInSeconds,
    );
  }

  async getObjectForProcessing(key: string): Promise<Buffer> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));

    if (!object.Body) {
      throw new Error(`Storage object not found: ${key}`);
    }

    const chunks: Buffer[] = [];
    // @ts-expect-error S3 SDK returns a Node readable stream on Node runtimes.
    for await (const chunk of object.Body) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async putProcessedObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async generatePresignedGetUrl(
    key: string,
    expiresInSeconds: number,
    responseContentDisposition?: string,
    responseContentType?: string,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: responseContentDisposition,
        ResponseContentType: responseContentType,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async getObject(key: string): Promise<GetObjectCommandOutput> {
    return this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return {
        key,
        size: Number(object.ContentLength || 0),
        contentType: object.ContentType,
        etag: object.ETag?.replaceAll('"', ''),
      };
    } catch (error) {
      const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
      const name = (error as { name?: string }).name;
      if (metadata?.httpStatusCode === 404 || name === 'NotFound') {
        return null;
      }
      throw error;
    }
  }

  async createMultipart(input: CreateMultipartInput): Promise<{ uploadId: string }> {
    const result = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
    );

    if (!result.UploadId) {
      throw new Error('Storage did not return an upload id');
    }

    return { uploadId: result.UploadId };
  }

  async createPartPutUrl(input: PartPutUrlInput): Promise<string> {
    return this.presignUploadPart(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
      }),
      input.expiresInSeconds,
    );
  }

  async completeMultipart(input: CompleteMultipartInput): Promise<{ key: string; etag?: string }> {
    const result = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map(({ partNumber, etag }) => ({
            PartNumber: partNumber,
            ETag: etag,
          })),
        },
      }),
    );

    return { key: input.key, etag: result.ETag?.replaceAll('"', '') };
  }

  async abortMultipart(input: AbortMultipartInput): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: input.key,
        UploadId: input.uploadId,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
