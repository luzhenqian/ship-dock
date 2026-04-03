import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

function mockContext(userRole: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: '1', role: userRole } }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('allows access when no role is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(mockContext('VIEWER'))).toBe(true);
  });

  it('allows OWNER when ADMIN is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('ADMIN');
    expect(guard.canActivate(mockContext('OWNER'))).toBe(true);
  });

  it('denies VIEWER when DEVELOPER is required', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('DEVELOPER');
    expect(guard.canActivate(mockContext('VIEWER'))).toBe(false);
  });

  it('allows exact role match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('DEVELOPER');
    expect(guard.canActivate(mockContext('DEVELOPER'))).toBe(true);
  });
});
