import { describe, expect, it } from 'vitest';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { evaluateVelocityGate } from './velocity-gate.util';

function entry(
  velocity?: SpatialEntryContract['velocity']
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
    arbitration: { pacingFactor: 1, weights: { p: 1, d: 1, h: 1 } },
    velocity,
  };
}

describe('evaluateVelocityGate', () => {
  it('allows when under maxKmhSilence', () => {
    const r = evaluateVelocityGate(40, entry({ maxKmhSilence: 80 }));
    expect(r).toEqual({ allowed: true });
  });

  it('suppresses when over maxKmhSilence', () => {
    const r = evaluateVelocityGate(90, entry({ maxKmhSilence: 80 }));
    expect(r).toEqual({ allowed: false, reason: 'too_fast' });
  });

  it('allows when velocity policy is absent', () => {
    expect(evaluateVelocityGate(200, entry(undefined)).allowed).toBe(true);
  });
});
