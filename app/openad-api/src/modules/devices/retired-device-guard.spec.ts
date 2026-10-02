import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { RetiredDeviceGuard } from './retired-device-guard';
import { RetiredDeviceRegistryRepository } from './retired-device-registry.repository';

describe('RetiredDeviceGuard', () => {
  let guard: RetiredDeviceGuard;
  let retired: { exists: jest.Mock };

  beforeEach(() => {
    retired = { exists: jest.fn() };
    guard = new RetiredDeviceGuard(
      retired as unknown as RetiredDeviceRegistryRepository
    );
  });

  function mockContext(
    partial: { params?: Record<string, string>; body?: Record<string, unknown> }
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          params: partial.params ?? {},
          body: partial.body ?? {},
        }),
      }),
    } as ExecutionContext;
  }

  it('returns true when deviceId is absent', async () => {
    const ok = await guard.canActivate(
      mockContext({ params: {}, body: {} })
    );
    expect(ok).toBe(true);
    expect(retired.exists).not.toHaveBeenCalled();
  });

  it('returns true when device is not retired', async () => {
    retired.exists.mockResolvedValue(false);
    const ok = await guard.canActivate(
      mockContext({ params: { deviceId: 'd1' } })
    );
    expect(ok).toBe(true);
    expect(retired.exists).toHaveBeenCalledWith('d1');
  });

  it('throws ForbiddenException when device is retired', async () => {
    retired.exists.mockResolvedValue(true);
    await expect(
      guard.canActivate(mockContext({ params: { deviceId: 'd1' } }))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reads deviceId from body when not in params', async () => {
    retired.exists.mockResolvedValue(true);
    await expect(
      guard.canActivate(
        mockContext({ params: {}, body: { deviceId: 'body-id' } })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(retired.exists).toHaveBeenCalledWith('body-id');
  });
});
