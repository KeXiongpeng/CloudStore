import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { WorkspaceActor } from '../workspaces/decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from '../workspaces/types';
import { AuditService } from './audit.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('workspaces/audit-logs')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('audit:read')
  listByQuery(@Query('workspaceId') workspaceId: string, @Query() query: QueryAuditLogDto) {
    return this.auditService.list(workspaceId, query);
  }

  @Get('audit-logs')
  listLocal(@Query('workspaceId') workspaceId: string, @Query() query: QueryAuditLogDto) {
    return this.auditService.list(workspaceId, query);
  }
}
