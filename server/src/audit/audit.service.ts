import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface RecordAuditInput {
  workspaceId?: string | null;
  actorId?: string | null;
  action: string;
  resourceType: 'workspace' | 'member' | 'file' | 'upload' | 'invitation';
  resourceId: string;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditQuery {
  page: number;
  limit: number;
  action?: string;
  actorId?: string;
  resourceType?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          workspaceId: input.workspaceId ?? null,
          actorId: input.actorId ?? null,
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          requestId: input.requestId ?? null,
          before:
            input.before === undefined ? Prisma.JsonNull : (input.before as Prisma.InputJsonValue),
          after:
            input.after === undefined ? Prisma.JsonNull : (input.after as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      this.logger.error(`audit write failed for ${input.action}`, (error as Error).stack);
    }
  }

  async list(workspaceId: string, query: AuditQuery) {
    const where = {
      workspaceId,
      action: query.action,
      actorId: query.actorId,
      resourceType: query.resourceType,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items,
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.ceil(total / query.limit),
    };
  }
}
