import {
  BadRequestException,
  ConflictException,
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
import { CompleteSessionDto, CreateUploadSessionDto } from './dto/create-upload-session.dto';

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

  private async requireSession(actor: WorkspaceActorContext, uploadSessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: uploadSessionId, workspaceId: actor.workspaceId },
      include: {
        chunks: { orderBy: { chunkIndex: 'asc' } },
        file: true,
      },
    });

    if (!session) throw new NotFoundException('UPLOAD_SESSION_NOT_FOUND');
    if (session.createdBy !== actor.userId && !['OWNER', 'ADMIN'].includes(actor.role)) {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    return session;
  }

  async createSession(actor: WorkspaceActorContext, dto: CreateUploadSessionDto) {
    if (dto.filename.includes('/') || dto.filename.includes('\\')) {
      throw new BadRequestException('VALIDATION_ERROR');
    }

    const size = BigInt(Math.ceil(dto.size));
    const chunkSize = dto.chunkSize ?? 8 * BYTES_PER_MB;
    const totalChunks = Math.max(1, Math.ceil(dto.size / chunkSize));
    const clientUploadId = dto.clientUploadId ?? randomUUID();
    const hashAlgorithm = dto.hashAlgorithm || 'sha256';
    let sessionId: string | undefined;
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
        // Preserve the original session-creation error.
      }

      const message = error instanceof Error ? error.message : '';
      if (message.toLowerCase().includes('foreign key') || message.includes('P2003')) {
        throw new BadRequestException('UPLOAD_FOLDER_NOT_FOUND');
      }
      throw error;
    }
  }

  async getResume(actor: WorkspaceActorContext, uploadSessionId: string) {
    const session = await this.requireSession(actor, uploadSessionId);

    if (session.status === 'expired') {
      throw new HttpException({ code: 'UPLOAD_SESSION_EXPIRED' }, 410);
    }

    const uploadedChunks = session.chunks
      .filter((chunk) => chunk.status === 'uploaded')
      .map((chunk) => chunk.chunkIndex);

    return {
      uploadSessionId: session.id,
      status: session.status,
      strategy: session.strategy,
      mode: session.mode,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedChunks,
      missingChunks: session.chunks
        .filter((chunk) => chunk.status !== 'uploaded')
        .map((chunk) => chunk.chunkIndex),
      expiresAt: session.expiresAt,
    };
  }

  async createDirectUrl(actor: WorkspaceActorContext, uploadSessionId: string) {
    const session = await this.requireSession(actor, uploadSessionId);
    if (session.mode !== 'direct') throw new ConflictException('UPLOAD_SESSION_MODE_INVALID');
    if (session.status !== 'pending' && session.status !== 'uploading') {
      throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const uploadUrl = await this.storageService.createDirectPutUrl({
      key: session.storageKey,
      contentType: session.mimeType,
      expiresInSeconds: 900,
    });

    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'uploading' },
    });

    return { uploadUrl, expiresAt };
  }

  async cancel(actor: WorkspaceActorContext, uploadSessionId: string) {
    const session = await this.requireSession(actor, uploadSessionId);
    if (['completed', 'canceled', 'expired'].includes(session.status)) {
      throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
    }

    if (session.mode === 'multipart' && session.providerUploadId) {
      await this.storageService.abortMultipart({
        key: session.storageKey,
        uploadId: session.providerUploadId,
      });
    }

    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'canceled', failureReason: 'canceled_by_user' },
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
      actorId: actor.userId,
      action: 'upload.canceled',
      resourceType: 'upload',
      resourceId: session.id,
    });

    return { id: session.id };
  }

  async createChunkUrls(
    actor: WorkspaceActorContext,
    uploadSessionId: string,
    chunkIndexes: number[],
  ) {
    const session = await this.requireSession(actor, uploadSessionId);
    if (session.mode !== 'multipart' || !session.providerUploadId) {
      throw new ConflictException('UPLOAD_SESSION_MODE_INVALID');
    }

    const unique = [...new Set(chunkIndexes)].sort((a, b) => a - b);
    const urls = await Promise.all(
      unique.map(async (chunkIndex) => ({
        chunkIndex,
        uploadUrl: await this.storageService.createPartPutUrl({
          key: session.storageKey,
          uploadId: session.providerUploadId as string,
          partNumber: chunkIndex,
          expiresInSeconds: 3600,
        }),
        expiresAt: new Date(Date.now() + 3600 * 1000),
      })),
    );

    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'uploading' },
    });

    return urls;
  }

  async confirmChunk(
    actor: WorkspaceActorContext,
    uploadSessionId: string,
    chunkIndex: number,
    etag: string,
  ) {
    const session = await this.requireSession(actor, uploadSessionId);
    if (session.status !== 'uploading' && session.status !== 'pending') {
      throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
    }

    const chunk = await this.prisma.uploadChunk.findUnique({
      where: {
        uploadSessionId_chunkIndex: { uploadSessionId: session.id, chunkIndex },
      },
    });

    if (!chunk) throw new ConflictException('UPLOAD_CHUNK_INVALID');
    if (chunk.status === 'uploaded' && chunk.etag === etag) {
      return { chunkIndex, uploadedChunks: session.uploadedChunks };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.uploadChunk.update({
        where: { id: chunk.id },
        data: { status: 'uploaded', etag, uploadedAt: new Date() },
      });

      const updated = await tx.uploadSession.update({
        where: { id: session.id },
        data: { uploadedChunks: { increment: 1 }, status: 'uploading' },
        select: { uploadedChunks: true },
      });

      return { chunkIndex, uploadedChunks: updated.uploadedChunks };
    });
  }

  private async createFileAndVersion(input: {
    actor: WorkspaceActorContext;
    session: {
      id: string;
      workspaceId: string;
      folderId: string | null;
      createdBy: string;
      filename: string;
      mimeType: string;
      size: bigint;
      hash: string | null;
      hashAlgorithm: string;
      storageKey: string;
    };
  }) {
    const file = await this.prisma.file.create({
      data: {
        workspaceId: input.session.workspaceId,
        folderId: input.session.folderId,
        createdBy: input.actor.userId,
        updatedBy: input.actor.userId,
        name: input.session.filename,
        mimeType: input.session.mimeType,
        extension: this.extension(input.session.filename),
        size: input.session.size,
        hash: input.session.hash,
        hashAlgorithm: input.session.hashAlgorithm,
        uploadSessionId: input.session.id,
        urlKey: randomUUID().replace(/-/g, ''),
        visibility: 'private',
      },
    });

    const version = await this.prisma.fileVersion.create({
      data: {
        fileId: file.id,
        versionNo: 1,
        storageKey: input.session.storageKey,
        size: input.session.size,
        hash: input.session.hash,
        hashAlgorithm: input.session.hashAlgorithm,
        mimeType: input.session.mimeType,
        createdBy: input.actor.userId,
      },
    });

    await this.prisma.file.update({
      where: { id: file.id },
      data: { currentVersionId: version.id },
    });

    return { file, version };
  }

  private async upsertStorageObject(session: {
    hash: string | null;
    hashAlgorithm: string;
    size: bigint;
    storageKey: string;
  }) {
    if (!session.hash) {
      await this.prisma.storageObject.create({
        data: {
          hashAlgorithm: session.hashAlgorithm,
          hash: `unverified:${session.storageKey}`,
          size: session.size,
          storageDriver: this.storageService.driverName,
          storageKey: session.storageKey,
          referenceCount: 1,
        },
      });
      return;
    }

    const object = await this.prisma.storageObject.findUnique({
      where: {
        storageDriver_hashAlgorithm_hash: {
          storageDriver: this.storageService.driverName,
          hashAlgorithm: session.hashAlgorithm,
          hash: session.hash,
        },
      },
    });

    if (object) {
      await this.prisma.storageObject.update({
        where: { id: object.id },
        data: { referenceCount: { increment: 1 } },
      });
      return;
    }

    await this.prisma.storageObject.create({
      data: {
        hashAlgorithm: session.hashAlgorithm,
        hash: session.hash,
        size: session.size,
        storageDriver: this.storageService.driverName,
        storageKey: session.storageKey,
        referenceCount: 1,
      },
    });
  }

  async complete(actor: WorkspaceActorContext, uploadSessionId: string, dto: CompleteSessionDto) {
    const session = await this.requireSession(actor, uploadSessionId);

    if (session.status === 'completed' && session.file) {
      return {
        fileId: session.file.id,
        urlKey: session.file.urlKey,
        name: session.file.name,
        size: Number(session.size),
        strategy: session.strategy,
      };
    }

    if (['failed', 'canceled', 'expired', 'merging', 'completed'].includes(session.status)) {
      throw new ConflictException('UPLOAD_SESSION_ALREADY_COMPLETED');
    }

    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'merging' },
    });

    try {
      if (session.mode === 'multipart') {
        const incomplete =
          session.chunks.length !== session.totalChunks ||
          session.chunks.some((chunk) => chunk.status !== 'uploaded');
        if (incomplete || !session.providerUploadId) {
          throw new ConflictException('UPLOAD_CHUNK_INVALID');
        }

        await this.storageService.completeMultipart({
          key: session.storageKey,
          uploadId: session.providerUploadId,
          parts: session.chunks.map((chunk) => ({
            partNumber: chunk.chunkIndex,
            etag: chunk.etag as string,
          })),
        });
      }

      const object = await this.storageService.headObject(session.storageKey);
      if (!object || object.size !== Number(session.size)) {
        throw new NotFoundException('UPLOAD_OBJECT_SIZE_MISMATCH');
      }

      const effectiveHash = dto.hash?.toLowerCase() ?? session.hash;
      const effectiveSession = { ...session, hash: effectiveHash };

      await this.prisma.$transaction(async (tx) => {
        await tx.uploadSession.update({
          where: { id: session.id },
          data: { hash: effectiveHash, status: 'completed', completedAt: new Date() },
        });
      });

      await this.upsertStorageObject(effectiveSession);
      const created = await this.createFileAndVersion({ actor, session: effectiveSession });

      await this.quotaService.confirm({
        workspaceId: session.workspaceId,
        uploadSessionId: session.id,
        size: session.size,
      });

      await this.auditService.record({
        workspaceId: session.workspaceId,
        actorId: actor.userId,
        action: session.strategy === 'instant' ? 'file.instant_uploaded' : 'file.uploaded',
        resourceType: 'file',
        resourceId: created.file.id,
        after: {
          uploadSessionId: session.id,
          size: Number(session.size),
          hash: effectiveHash,
        },
      });

      return {
        fileId: created.file.id,
        urlKey: created.file.urlKey,
        name: created.file.name,
        size: Number(session.size),
        strategy: session.strategy,
      };
    } catch (error) {
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: 'failed', failureReason: (error as Error).message.slice(0, 1000) },
      });
      throw error;
    }
  }

  async confirmInstant(actor: WorkspaceActorContext, uploadSessionId: string) {
    const session = await this.requireSession(actor, uploadSessionId);

    if (session.status === 'completed' && session.file) {
      return { fileId: session.file.id, urlKey: session.file.urlKey };
    }
    if (session.strategy !== 'instant') {
      throw new ConflictException('UPLOAD_INSTANT_NOT_AVAILABLE');
    }
    if (!session.hash) {
      throw new ConflictException('UPLOAD_HASH_REQUIRED');
    }

    const object = await this.prisma.storageObject.findUnique({
      where: {
        storageDriver_hashAlgorithm_hash: {
          storageDriver: this.storageService.driverName,
          hashAlgorithm: session.hashAlgorithm,
          hash: session.hash,
        },
      },
    });

    if (!object || object.status !== 'available' || object.size !== session.size) {
      throw new ConflictException('UPLOAD_INSTANT_NOT_AVAILABLE');
    }

    await this.prisma.storageObject.update({
      where: { id: object.id },
      data: { referenceCount: { increment: 1 } },
    });

    const created = await this.createFileAndVersion({ actor, session });

    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'completed', completedAt: new Date() },
    });

    await this.quotaService.confirm({
      workspaceId: session.workspaceId,
      uploadSessionId: session.id,
      size: session.size,
    });

    await this.auditService.record({
      workspaceId: session.workspaceId,
      actorId: actor.userId,
      action: 'file.instant_uploaded',
      resourceType: 'file',
      resourceId: created.file.id,
      after: { storageObjectId: object.id, size: Number(session.size) },
    });

    return {
      fileId: created.file.id,
      urlKey: created.file.urlKey,
      name: created.file.name,
      size: Number(session.size),
      strategy: 'instant' as const,
    };
  }
}
