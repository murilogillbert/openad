import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DeviceJwtAuthGuard } from './device-jwt-auth.guard';
import type { DevicesRepository } from './devices.repository';

function mockContext(req: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req as Request,
    }),
  } as ExecutionContext;
}

describe('DeviceJwtAuthGuard', () => {
  const deviceId = 'dev-1';
  const fp = 'abc'.repeat(10) + 'ab';

  it('allows valid token without stored fingerprint', async () => {
    const jwt = {
      verify: jest.fn().mockReturnValue({ sub: deviceId, typ: 'device' }),
    } as unknown as JwtService;
    const devices = {
      findByDeviceId: jest.fn().mockResolvedValue({ hardwareFingerprintHash: null }),
    } as unknown as DevicesRepository;
    const guard = new DeviceJwtAuthGuard(jwt, devices);
    await expect(
      guard.canActivate(
        mockContext({
          params: { deviceId },
          headers: { authorization: 'Bearer t' },
        })
      )
    ).resolves.toBe(true);
  });

  it('rejects when fp claim missing but device requires fingerprint', async () => {
    const jwt = {
      verify: jest.fn().mockReturnValue({ sub: deviceId, typ: 'device' }),
    } as unknown as JwtService;
    const devices = {
      findByDeviceId: jest.fn().mockResolvedValue({ hardwareFingerprintHash: fp }),
    } as unknown as DevicesRepository;
    const guard = new DeviceJwtAuthGuard(jwt, devices);
    await expect(
      guard.canActivate(
        mockContext({
          params: { deviceId },
          headers: { authorization: 'Bearer t' },
        })
      )
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws HARDWARE_MISMATCH when header does not match fp claim', async () => {
    const jwt = {
      verify: jest
        .fn()
        .mockReturnValue({ sub: deviceId, typ: 'device', fp }),
    } as unknown as JwtService;
    const devices = {
      findByDeviceId: jest.fn().mockResolvedValue({ hardwareFingerprintHash: fp }),
    } as unknown as DevicesRepository;
    const guard = new DeviceJwtAuthGuard(jwt, devices);
    await expect(
      guard.canActivate(
        mockContext({
          params: { deviceId },
          headers: {
            authorization: 'Bearer t',
            'x-device-fingerprint-hash': 'wrong',
          },
        })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows when header matches fp and stored hash', async () => {
    const jwt = {
      verify: jest
        .fn()
        .mockReturnValue({ sub: deviceId, typ: 'device', fp }),
    } as unknown as JwtService;
    const devices = {
      findByDeviceId: jest.fn().mockResolvedValue({ hardwareFingerprintHash: fp }),
    } as unknown as DevicesRepository;
    const guard = new DeviceJwtAuthGuard(jwt, devices);
    await expect(
      guard.canActivate(
        mockContext({
          params: { deviceId },
          headers: {
            authorization: 'Bearer t',
            'x-device-fingerprint-hash': fp,
          },
        })
      )
    ).resolves.toBe(true);
  });
});
