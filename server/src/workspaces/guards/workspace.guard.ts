import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { WorkspacesService } from '../workspaces.service';
import { WorkspaceActorContext } from '../types';

interface WorkspaceRequest extends Request {
  user?: { id?: string };
  workspaceActor?: WorkspaceActorContext;
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly workspacesService: WorkspacesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const workspaceId = request.params.workspaceId;
    const userId = request.user?.id;

    if (!workspaceId || !userId) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND');
    }

    request.workspaceActor = await this.workspacesService.requireMembership(workspaceId, userId);
    return true;
  }
}
