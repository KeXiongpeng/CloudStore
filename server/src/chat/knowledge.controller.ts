import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionGuard, WorkspaceGuard } from '../workspaces';
import { RequirePermission } from '../workspaces/decorators/require-permission.decorator';
import { KnowledgeService } from './knowledge.service';

@ApiTags('knowledge')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceGuard)
@Controller('workspaces/:workspaceId/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('stats')
  @UseGuards(PermissionGuard)
  @RequirePermission('file:view')
  @ApiOperation({ summary: '获取当前工作区知识库索引状态' })
  stats(@Param('workspaceId') workspaceId: string) {
    return this.knowledgeService.getStats({ workspaceId });
  }
}
