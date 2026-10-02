import { describe, expect, it } from 'vitest';
import type { SpatialEntryContract } from '@openad/api-contracts';
import {
  arbitrationScore,
  arbitrationScoreBreakdown,
  inverseDistanceScore,
  pacingTerm,
  headingTerm,
} from './arbitration-score.util';

function baseEntry(
  weights: SpatialEntryContract['arbitration']['weights'],
  pacing = 1
): SpatialEntryContract {
  return {
    zoneId: '550e8400-e29b-41d4-a716-446655440000',
    tier: 'T4',
    priorityScore: 1,
    geometry: {
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
    mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    trigger: { mode: 'entry' },
    rotation: 'sequential',
    arbitration: { pacingFactor: pacing, weights },
  };
}

describe('inverseDistanceScore / pacingTerm / headingTerm', () => {
  it('inverseDistanceScore is 1 at d=0 and decreases with distance', () => {
    expect(inverseDistanceScore(0)).toBe(1);
    expect(inverseDistanceScore(100)).toBeLessThan(1);
  });

  it('pacingTerm clamps at 0', () => {
    expect(pacingTerm(-1)).toBe(0);
  });

  it('headingTerm clamps to [0,1]', () => {
    expect(headingTerm(2)).toBe(1);
    expect(headingTerm(-1)).toBe(0);
  });
});

describe('arbitrationScore', () => {
  it('increases with closer distance (inverse distance term)', () => {
    const e = baseEntry({ p: 0, d: 1, h: 0 });
    const far = arbitrationScore(e, {
      distanceToEpicenterM: 10_000,
      headingAlign01: 0.5,
    });
    const near = arbitrationScore(e, {
      distanceToEpicenterM: 10,
      headingAlign01: 0.5,
    });
    expect(near).toBeGreaterThan(far);
  });

  it('scales with pacingFactor', () => {
    const a = baseEntry({ p: 1, d: 0, h: 0 }, 2);
    const b = baseEntry({ p: 1, d: 0, h: 0 }, 1);
    expect(arbitrationScore(a, { distanceToEpicenterM: 0, headingAlign01: 1 })).toBe(
      2 * arbitrationScore(b, { distanceToEpicenterM: 0, headingAlign01: 1 })
    );
  });

  it('arbitrationScoreBreakdown matches total', () => {
    const e = baseEntry({ p: 1, d: 1, h: 1 }, 1);
    const ctx = { distanceToEpicenterM: 50, headingAlign01: 0.8 };
    const b = arbitrationScoreBreakdown(e, ctx);
    expect(b.total).toBe(arbitrationScore(e, ctx));
  });
});
