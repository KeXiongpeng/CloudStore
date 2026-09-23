import { Injectable } from '@nestjs/common';
import { StorageDriver } from './storage-driver';

@Injectable()
export class StorageService {
  constructor(
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

  deleteObject(key: string) {
    return this.driver.deleteObject(key);
  }
}
