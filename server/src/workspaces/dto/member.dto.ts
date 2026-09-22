import { IsEmail, IsIn, IsUUID } from 'class-validator';
import { WorkspaceRole } from '../types';

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(['ADMIN', 'EDITOR', 'VIEWER', 'GUEST'])
  role!: Exclude<WorkspaceRole, 'OWNER'>;
}

export class UpdateMemberRoleDto {
  @IsIn(['ADMIN', 'EDITOR', 'VIEWER', 'GUEST'])
  role!: Exclude<WorkspaceRole, 'OWNER'>;
}

export class AcceptInvitationDto {
  @IsUUID()
  token!: string;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  requestId: string;
}
