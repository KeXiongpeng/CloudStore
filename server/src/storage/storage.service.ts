import { Inject, Injectable } from '@nestjs/common';
import { StorageDriver } from './storage-driver';
import { GetObjectCommandOutput } from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  constructor(
    @Inject('STORAGE_DRIVERS')
    private readonly drivers: {
      driver: 'minio' | 'qiniu';
      minio: StorageDriver;
      qiniu: StorageDriver;
    },
  ) {}

  get driverName(): 'minio' | 'qiniu' {
    return this.drivers.driver;
  }

  private get driver(): StorageDriver {
    return this.drivers.driver === 'minio' ? this.drivers.minio : this.drivers.qiniu;
  }

  createDirectPutUrl(input: Parameters<StorageDriver['createDirectPutUrl']>[0]) {
    return this.driver.createDirectPutUrl(input);
  }

  generatePresignedGetUrl(
    key: string,
    expiresInSeconds = 3600,
    responseContentDisposition?: string,
  ): Promise<string> {
    return this.driver.generatePresignedGetUrl(key, expiresInSeconds, responseContentDisposition);
  }

  getObject(key: string): Promise<GetObjectCommandOutput> {
    return this.driver.getObject(key);
  }

  headObject(key: string) {
    return this.driver.headObject(key);
  }

  createMultipart(input: Parameters<StorageDriver['createMultipart']>[0]) {
    return this.driver.createMultipart(input);
  }

  createPartPutUrl(input: Parameters<StorageDriver['createPartPutUrl']>[0]) {
    return this.driver.createPartPutUrl(input);
  }

  completeMultipart(input: Parameters<StorageDriver['completeMultipart']>[0]) {
    return this.driver.completeMultipart(input);
  }

  abortMultipart(input: Parameters<StorageDriver['abortMultipart']>[0]) {
    return this.driver.abortMultipart(input);
  }

  getObjectForProcessing(key: string): Promise<Buffer> {
    return this.driver.getObjectForProcessing(key);
  }

  putProcessedObject(key: string, body: Buffer, contentType: string): Promise<void> {
    return this.driver.putProcessedObject(key, body, contentType);
  }

  deleteObject(key: string) {
    return this.driver.deleteObject(key);
  }
}
