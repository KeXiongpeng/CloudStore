import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from '../../src/workspaces/guards/permission.guard';

function createContext(role: string): ExecutionContext {
  return {
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        workspaceActor: { userId: 'u', workspaceId: 'w', memberId: 'm', role },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  it('denies when the role lacks the required permission', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'get').mockReturnValue('file:upload');
    const guard = new PermissionGuard(reflector);

    expect(() => guard.canActivate(createContext('VIEWER'))).toThrow(ForbiddenException);
  });

  it('allows when the role has the required permission', () => {
    const reflector = new Reflector();
    jest.spyOn(reflector, 'get').mockReturnValue('file:upload');
    const guard = new PermissionGuard(reflector);

    expect(guard.canActivate(createContext('EDITOR'))).toBe(true);
  });
});
