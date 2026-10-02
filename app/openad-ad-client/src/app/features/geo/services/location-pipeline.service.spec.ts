import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { LocationPipelineService } from './location-pipeline.service';

describe('LocationPipelineService', () => {
  let svc: LocationPipelineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(LocationPipelineService);
    svc.reset();
    svc._setConfig({
      smoothingAlpha: 0.5,
      minPollIntervalMs: 1_000,
      maxPollIntervalMs: 60_000,
      deadReckoningTimeoutMs: 10_000,
    });
  });

  it('smooths successive fixes toward the latest sample', () => {
    const t0 = 1_000_000;
    const a = svc.processRaw(0, 0, t0);
    expect(a.lng).toBe(0);
    expect(a.lat).toBe(0);
    const b = svc.processRaw(10, 0, t0 + 1000);
    expect(b.lng).toBeGreaterThan(0);
    expect(b.lng).toBeLessThan(10);
  });

  it('suggests shorter poll intervals at higher speed', () => {
    const t = 2_000_000;
    const slow = svc.processRaw(-46.6, -23.5, t, { speedKmh: 5 });
    svc.reset();
    const fast = svc.processRaw(-46.6, -23.5, t, { speedKmh: 80 });
    expect(fast.suggestedNextPollMs).toBeLessThanOrEqual(slow.suggestedNextPollMs);
  });

  it('positionForEvaluation extrapolates when fix is stale and speed is known', () => {
    const t0 = 5_000_000;
    svc.processRaw(-46.6, -23.5, t0, { speedKmh: 36 });
    const t1 = t0 + 12_000;
    const p = svc.positionForEvaluation(t1);
    expect(p).not.toBeNull();
    expect(svc.lastDeadReckoned()).toBe(true);
  });
});
