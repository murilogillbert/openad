import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HardwareFingerprintService } from './hardware-fingerprint.service';

vi.mock('@capacitor/device', () => ({
  Device: {
    getId: vi.fn().mockResolvedValue({ identifier: 'test-serial-xyz' }),
  },
}));

describe('HardwareFingerprintService', () => {
  let svc: HardwareFingerprintService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(HardwareFingerprintService);
  });

  it('produces stable hash for fixed tuple', async () => {
    const h1 = await svc.hashFingerprint({
      imei: null,
      serialNumber: 'A',
      macAddress: '00:11:22:33:44:55',
    });
    const h2 = await svc.hashFingerprint({
      imei: null,
      serialNumber: 'A',
      macAddress: '00:11:22:33:44:55',
    });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('collect returns components when Device.getId succeeds', async () => {
    const c = await svc.collect();
    expect('flag' in c).toBe(false);
    if ('serialNumber' in c) {
      expect(c.serialNumber).toBe('test-serial-xyz');
    }
  });
});
