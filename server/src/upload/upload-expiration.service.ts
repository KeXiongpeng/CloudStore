import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class UploadExpirationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly redisService: RedisService,
  ) {}

  async expireDueSessions(now = new Date()) {
    const sessions = await this.prisma.uploadSession.findMany({
      where: {
        status: { in: ['pending', 'uploading', 'merging'] },
        expiresAt: { lt: now },
      },
      take: 200,
    });

    let expiredCount = 0;

    for (const session of sessions) {
      try {
        if (session.mode === 'multipart' && session.providerUploadId) {
          await this.storageService.abortMultipart({
            key: session.storageKey,
            uploadId: session.providerUploadId,
          });
        }

        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: { status: 'expired', failureReason: 'session_expired' },
        });

        if (session.quotaReserved > BigInt(0)) {
          await this.quotaService.release({
            workspaceId: session.workspaceId,
            uploadSessionId: session.id,
            size: session.quotaReserved,
          });
        }

        await this.auditService.record({
          workspaceId: session.workspaceId,
          actorId: session.createdBy,
          action: 'upload.expired',
          resourceType: 'upload',
          resourceId: session.id,
          after: { size: Number(session.size) },
        });

        expiredCount += 1;
      } catch (error) {
        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: {
            failureReason: `expiry_failed:${(error as Error).message}`.slice(0, 1000),
          },
        });
      }
    }

    return { expiredCount };
  }

  async acquireMergeLock(uploadSessionId: string) {
    const value = randomUUID();
    const acquired = await this.redisService.acquireLock(
      `upload:merge:${uploadSessionId}`,
      value,
      120,
    );
    if (!acquired) throw new Error('UPLOAD_MERGE_LOCK_BUSY');

    return value;
  }

  async releaseMergeLock(uploadSessionId: string, value: string) {
    await this.redisService.releaseLock(`upload:merge:${uploadSessionId}`, value);
  }
}
