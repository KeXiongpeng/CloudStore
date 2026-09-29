import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { WorkspaceActorContext } from '../types';

export const WorkspaceActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): WorkspaceActorContext =>
    context.switchToHttp().getRequest().workspaceActor,
);
