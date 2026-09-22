import { IsEmail, IsIn, IsString, Length } from 'class-validator';
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
  @IsString()
  @Length(64, 64)
  token!: string;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  requestId: string;
}
