import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { WorkspaceActorContext } from '../workspaces/types';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';

const BYTES_PER_MB = 1024 * 1024;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class UploadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  private extension(filename: string): string {
    const index = filename.lastIndexOf('.');
    return index > 0
      ? filename
          .slice(index + 1)
          .toLowerCase()
          .slice(0, 32)
      : '';
  }

  private storageKey(workspaceId: string, filename: string) {
    const now = new Date();
    const key = `${workspaceId}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const ext = this.extension(filename);
    return ext ? `${key}.${ext}` : key;
  }

  async createSession(actor: WorkspaceActorContext, dto: CreateUploadSessionDto) {
    if (dto.filename.includes('/') || dto.filename.includes('\\')) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const size = BigInt(Math.ceil(dto.size));
    const chunkSize = dto.chunkSize ?? 8 * BYTES_PER_MB;
    const totalChunks = Math.max(1, Math.ceil(dto.size / chunkSize));
    const clientUploadId = dto.clientUploadId ?? randomUUID();
    let sessionId: string | undefined;
    const hashAlgorithm = dto.hashAlgorithm || 'sha256';
    const strategy: 'normal' | 'instant' =
      dto.hash && hashAlgorithm === 'sha256'
        ? (
            await this.prisma.storageObject.findUnique({
              where: {
                storageDriver_hashAlgorithm_hash: {
                  storageDriver: this.storageService.driverName,
                  hashAlgorithm,
                  hash: dto.hash.toLowerCase(),
                },
              },
            })
          )?.status === 'available'
          ? 'instant'
          : 'normal'
        : 'normal';

    try {
      await this.quotaService.reserve({ workspaceId: actor.workspaceId, size });

      const session = await this.prisma.uploadSession.create({
        data: {
          clientUploadId,
          workspaceId: actor.workspaceId,
          folderId: dto.folderId,
          createdBy: actor.userId,
          filename: dto.filename,
          mimeType: dto.mimeType,
          size,
          hash: dto.hash?.toLowerCase(),
          hashAlgorithm,
          chunkSize,
          totalChunks,
          mode: dto.size <= 8 * BYTES_PER_MB ? 'direct' : 'multipart',
          strategy,
          status: strategy === 'instant' ? 'merging' : 'pending',
          storageKey: this.storageKey(actor.workspaceId, dto.filename),
          quotaReserved: size,
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
      sessionId = session.id;

      if (session.mode === 'multipart' && strategy === 'normal') {
        const multipart = await this.storageService.createMultipart({
          key: session.storageKey,
          contentType: dto.mimeType,
        });
        await this.prisma.uploadSession.update({
          where: { id: session.id },
          data: { providerUploadId: multipart.uploadId },
        });
        await this.prisma.uploadChunk.createMany({
          data: Array.from({ length: totalChunks }, (_, index) => ({
            uploadSessionId: session.id,
            chunkIndex: index + 1,
            size:
              index === totalChunks - 1
                ? size - BigInt((totalChunks - 1) * chunkSize)
                : BigInt(chunkSize),
          })),
        });
      }

      await this.auditService.record({
        workspaceId: actor.workspaceId,
        actorId: actor.userId,
        action: 'upload.created',
        resourceType: 'upload',
        resourceId: session.id,
        after: { filename: dto.filename, size: Number(size), strategy },
      });

      return {
        uploadSessionId: session.id,
        clientUploadId,
        mode: session.mode,
        strategy,
        chunkSize,
        totalChunks,
        uploadedChunks: [] as number[],
        expiresAt: session.expiresAt,
      };
    } catch (error) {
      try {
        await this.quotaService.release({
          workspaceId: actor.workspaceId,
          uploadSessionId: sessionId || clientUploadId,
          size,
        });
      } catch {
        // Keep the original storage/session error when quota cleanup also fails.
      }

      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('foreign key') || message.includes('P2003')) {
        throw new BadRequestException('UPLOAD_FOLDER_NOT_FOUND');
      }
      throw error;
    }
  }

  async getResume(actor: WorkspaceActorContext, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: uploadSessionId, workspaceId: actor.workspaceId },
      include: { chunks: { orderBy: { chunkIndex: 'asc' } } },
    });

    if (session?.status === 'expired') {
      throw new HttpException({ code: 'UPLOAD_SESSION_EXPIRED' }, 410);
    }

    if (!session) throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND');
    if (session.createdBy !== actor.userId && !['OWNER', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    const uploadedChunks = session.chunks
      .filter((chunk) => chunk.status === 'uploaded')
      .map((chunk) => chunk.chunkIndex);
    const missingChunks = session.chunks
      .filter((chunk) => chunk.status !== 'uploaded')
      .map((chunk) => chunk.chunkIndex);

    return {
      uploadSessionId: session.id,
      status: session.status,
      strategy: session.strategy,
      mode: session.mode,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedChunks,
      missingChunks,
      expiresAt: session.expiresAt,
    };
  }
}
