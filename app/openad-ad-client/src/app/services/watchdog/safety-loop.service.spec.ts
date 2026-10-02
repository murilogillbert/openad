import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { SafetyLoopService } from './safety-loop.service';
import { ManifestHealthService } from '../manifest-health.service';

describe('SafetyLoopService', () => {
  it('enters safety loop when manifest is stale', async () => {
    TestBed.configureTestingModule({
      providers: [
        SafetyLoopService,
        {
          provide: ManifestHealthService,
          useValue: {
            isStale: vi.fn().mockResolvedValue(true),
          },
        },
      ],
    });
    const svc = TestBed.inject(SafetyLoopService);
    await svc.tick();
    expect(svc.inSafetyLoop()).toBe(true);
  });
});
