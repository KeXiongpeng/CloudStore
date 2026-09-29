import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UploadExpirationService } from '../upload-expiration.service';

@Injectable()
export class UploadCronService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;

  constructor(private readonly expirationService: UploadExpirationService) {}

  onModuleInit() {
    this.timer = setInterval(
      () => {
        this.expirationService.expireDueSessions().catch((error) => {
          console.error('Upload expiry job failed', error);
        });
      },
      5 * 60 * 1000,
    );
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
