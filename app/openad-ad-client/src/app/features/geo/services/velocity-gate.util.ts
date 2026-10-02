import type { SpatialEntryContract } from '@openad/api-contracts';

export type VelocityGateResult =
  | { allowed: true }
  | { allowed: false; reason: 'too_fast' };

/**
 * Suppresses spatial playback when speed exceeds manifest `velocity.maxKmhSilence` (005 US3).
 */
export function evaluateVelocityGate(
  speedKmh: number | undefined,
  entry: SpatialEntryContract
): VelocityGateResult {
  const max = entry.velocity?.maxKmhSilence;
  if (max == null) {
    return { allowed: true };
  }
  if (speedKmh == null || Number.isNaN(speedKmh)) {
    return { allowed: true };
  }
  if (speedKmh > max) {
    return { allowed: false, reason: 'too_fast' };
  }
  return { allowed: true };
}
