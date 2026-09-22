import { SetMetadata } from '@nestjs/common';
import { WorkspacePermission } from '../types';

export const WORKSPACE_PERMISSION_KEY = 'workspacePermission';

export const RequirePermission = (permission: WorkspacePermission) =>
  SetMetadata(WORKSPACE_PERMISSION_KEY, permission);
