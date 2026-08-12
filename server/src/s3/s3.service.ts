import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class S3Service {
  private client: S3Client;
  private bucket: string;
  private cdnDomain: string;

  constructor(private configService: ConfigService) {
    const endpoint = this.configService.getOrThrow<string>('qiniu.endpoint');
    const region = 'cn-east-1';
    const accessKey = this.configService.getOrThrow<string>('qiniu.accessKey');
    const secretKey = this.configService.getOrThrow<string>('qiniu.secretKey');

    this.bucket = this.configService.getOrThrow<string>('qiniu.bucket');
    this.cdnDomain = this.configService.get<string>('qiniu.cdnDomain') || '';

    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
      // 七牛云 S3 兼容接口不支持 flexible checksum，需要禁用
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async generatePresignedPutUrl(
    key: string,
    contentType: string,
    ttlSeconds: number = 300,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  getPublicUrl(key: string): string {
    if (this.cdnDomain) {
      return `${this.cdnDomain}/${key}`;
    }
    const endpoint = this.configService.getOrThrow<string>('qiniu.endpoint');
    return `${endpoint}/${this.bucket}/${key}`;
  }

  async generatePresignedGetUrl(
    key: string,
    ttlSeconds: number = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  async createMultipartUpload(key: string, contentType: string) {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return this.client.send(command);
  }

  async uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ) {
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
      Body: body,
    });

    const response = await this.client.send(command);
    return {
      ETag: response.ETag,
      PartNumber: partNumber,
    };
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { ETag: string; PartNumber: number }[],
  ) {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts,
      },
    });

    return this.client.send(command);
  }

  async deleteObject(key: string) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return this.client.send(command);
  }

  async headObject(key: string) {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      return await this.client.send(command);
    } catch (error) {
      return null;
    }
  }

  async getObject(key: string) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return this.client.send(command);
  }
}
