import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function mockContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(mockContext({ role: 'fleet_operator' }))).toBe(
      true
    );
  });

  it('allows when user role is in required list', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['fleet_operator']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(mockContext({ role: 'fleet_operator' }))).toBe(
      true
    );
  });

  it('throws when user role is not allowed', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['fleet_admin']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() =>
      guard.canActivate(mockContext({ role: 'fleet_operator' }))
    ).toThrow(ForbiddenException);
  });

  it('allows super_admin regardless of required roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['fleet_admin']),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(mockContext({ role: 'super_admin' }))).toBe(true);
  });
});
