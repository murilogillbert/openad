import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApiClientService } from './api-client.service';
import { CapabilityManifestService } from './capability-manifest.service';
import { PairingEventsService } from './pairing-events.service';
import { ManifestHealthService } from './manifest-health.service';

vi.mock('@capacitor/device', () => ({
  Device: {
    getInfo: vi.fn().mockResolvedValue({
      model: 'test',
      platform: 'android',
      operatingSystem: 'android',
      osVersion: '14',
      manufacturer: 'acme',
      isVirtual: false,
      webViewVersion: '1',
    }),
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: vi.fn().mockResolvedValue({
      version: '1.2.3',
      build: '1',
      name: 'openad',
      id: 'x',
    }),
  },
}));

vi.mock('@capacitor/filesystem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@capacitor/filesystem')>();
  return {
    ...actual,
    Filesystem: {
      ...actual.Filesystem,
      stat: vi.fn().mockResolvedValue({
        size: 64 * 1024 * 1024 * 1024,
        free: 32 * 1024 * 1024 * 1024,
      }),
    },
  };
});

describe('CapabilityManifestService (integration-style)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PairingEventsService,
        CapabilityManifestService,
        {
          provide: ApiClientService,
          useValue: {
            patch: vi.fn().mockResolvedValue({}),
          },
        },
        {
          provide: ManifestHealthService,
          useValue: {
            recordSuccessfulFetch: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
  });

  it('PATCHes capability manifest with collected fields', async () => {
    const api = TestBed.inject(ApiClientService);
    const svc = TestBed.inject(CapabilityManifestService);
    await svc.report('device-uuid-1');

    expect(api.patch).toHaveBeenCalledWith(
      expect.stringContaining('/devices/device-uuid-1/capability-manifest'),
      expect.objectContaining({
        osVersion: '14',
        appVersion: '1.2.3',
        screenWidthPx: expect.any(Number),
        screenHeightPx: expect.any(Number),
      })
    );
    const mh = TestBed.inject(ManifestHealthService);
    expect(mh.recordSuccessfulFetch).toHaveBeenCalled();
  });
});
