import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasWorkspacePermission } from '../permissions';
import { WORKSPACE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { WorkspaceActorContext, WorkspacePermission } from '../types';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.get<WorkspacePermission>(
      WORKSPACE_PERMISSION_KEY,
      context.getHandler(),
    );
    const actor = context.switchToHttp().getRequest().workspaceActor as
      WorkspaceActorContext | undefined;

    if (!actor || !required || !hasWorkspacePermission(actor.role, required)) {
      throw new ForbiddenException('WORKSPACE_PERMISSION_DENIED');
    }

    return true;
  }
}
