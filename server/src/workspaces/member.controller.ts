import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PermissionGuard, WorkspaceGuard } from './guards';
import { RequirePermission } from './decorators/require-permission.decorator';
import { WorkspaceActor } from './decorators/workspace-actor.decorator';
import { WorkspaceActorContext } from './types';
import { MemberService } from './member.service';
import { AcceptInvitationDto, InviteMemberDto, UpdateMemberRoleDto } from './dto/member.dto';

function requestContext(req: Request) {
  return {
    ip: (req.ip || 'unknown') as string,
    userAgent: (req.headers['user-agent'] || 'unknown') as string,
    requestId: (req.headers['x-request-id'] || 'unknown') as string,
  };
}

@Controller()
@UseGuards(JwtAuthGuard)
export class MemberController {
  constructor(private readonly memberService: MemberService) {}

  @Get('workspaces/:workspaceId/members')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:read')
  list(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.memberService.listMembers(actor);
  }

  @Get('workspaces/:workspaceId/invitations')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:read')
  listInvitations(@WorkspaceActor() actor: WorkspaceActorContext) {
    return this.memberService.listInvitations(actor);
  }

  @Post('workspaces/:workspaceId/invitations')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:invite')
  invite(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Body() dto: InviteMemberDto,
    @Req() req: Request,
  ) {
    return this.memberService.inviteMember(actor, dto, requestContext(req));
  }

  @Patch('workspaces/:workspaceId/members/:memberId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:update_role')
  updateRole(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('memberId') memberId: string,
    @Body() dto: UpdateMemberRoleDto,
    @Req() req: Request,
  ) {
    return this.memberService.updateMemberRole(actor, memberId, dto, requestContext(req));
  }

  @Delete('workspaces/:workspaceId/members/:memberId')
  @UseGuards(WorkspaceGuard, PermissionGuard)
  @RequirePermission('member:remove')
  remove(
    @WorkspaceActor() actor: WorkspaceActorContext,
    @Param('memberId') memberId: string,
    @Req() req: Request,
  ) {
    return this.memberService.removeMember(actor, memberId, requestContext(req));
  }

  @Post('invitations/accept')
  accept(@CurrentUser('id') userId: string, @Body() dto: AcceptInvitationDto) {
    return this.memberService.acceptInvitation(userId, dto.token);
  }
}
