import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { ShadowQueueService } from './shadow-queue.service';
import { SpatialArbitrationEngineService } from './spatial-arbitration-engine.service';

function entry(
  overrides: Partial<SpatialEntryContract> & { zoneId: string; mediaId: string }
): SpatialEntryContract {
  const base: SpatialEntryContract = {
    zoneId: overrides.zoneId,
    tier: overrides.tier ?? 'T4',
    priorityScore: overrides.priorityScore ?? 1,
    geometry: overrides.geometry ?? {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    },
    mediaId: overrides.mediaId,
    trigger: overrides.trigger ?? { mode: 'entry' },
    rotation: overrides.rotation ?? 'sequential',
    arbitration: overrides.arbitration ?? {
      pacingFactor: 1,
      weights: { p: 1, d: 1, h: 1 },
    },
  };
  return { ...base, ...overrides };
}

describe('SpatialArbitrationEngineService', () => {
  let svc: SpatialArbitrationEngineService;
  let shadow: ShadowQueueService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(SpatialArbitrationEngineService);
    shadow = TestBed.inject(ShadowQueueService);
    shadow.clear();
    svc.resetSequentialCursor();
  });

  it('sequential rotates among peers', () => {
    const a = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });
    const b = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      mediaId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    });
    const g = [a, b];
    const first = svc.pickAmongPeers(g, 'sequential', 'k');
    const second = svc.pickAmongPeers(g, 'sequential', 'k');
    expect(first?.mediaId).not.toBe(second?.mediaId);
  });

  it('weighted_random returns one candidate', () => {
    const a = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });
    const pick = svc.pickAmongPeers([a], 'weighted_random', 'k');
    expect(pick?.mediaId).toBe(a.mediaId);
  });

  it('filterByTier keeps only the lowest-numbered tier present (T1 over T2)', () => {
    const t2 = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      tier: 'T2',
    });
    const t1 = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440001',
      mediaId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      tier: 'T1',
    });
    const f = svc.filterByTier([t2, t1]);
    expect(f.length).toBe(1);
    expect(f[0]?.tier).toBe('T1');
  });

  it('filterByTier does not return lower tiers when a higher tier is ready', () => {
    const t3 = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      tier: 'T3',
    });
    const t4 = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440001',
      mediaId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      tier: 'T4',
    });
    const f = svc.filterByTier([t4, t3]);
    expect(f.every((c) => c.tier === 'T3')).toBe(true);
  });

  it('applyLoopInterruptPolicy returns T1 only when loop is locked (emergency)', () => {
    const t4 = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      tier: 'T4',
    });
    const t1 = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440001',
      mediaId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      tier: 'T1',
    });
    const out = svc.applyLoopInterruptPolicy(
      [t4, t1],
      { playbackStatus: 'playing', currentKind: 'manifest' },
      shadow,
      0,
      0
    );
    expect(out.map((c) => c.tier)).toEqual(['T1']);
  });

  it('applyLoopInterruptPolicy defers non-T1 to shadow when loop is locked', () => {
    const t4 = entry({
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      tier: 'T4',
    });
    const out = svc.applyLoopInterruptPolicy(
      [t4],
      { playbackStatus: 'playing', currentKind: 'factory' },
      shadow,
      -46.6,
      -23.5
    );
    expect(out).toHaveLength(0);
    expect(shadow.size()).toBe(1);
  });
});
