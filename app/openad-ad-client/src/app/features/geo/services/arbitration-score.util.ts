import type { SpatialEntryContract } from '@openad/api-contracts';

export interface ArbitrationScoreContext {
  /** Distance from vehicle to zone epicenter in meters (smaller is better for inverse-distance term). */
  distanceToEpicenterM: number;
  /** Heading alignment in [0,1] where 1 is perfectly aligned. */
  headingAlign01: number;
}

/** Default length scale for inverse-distance falloff (meters). */
export const DEFAULT_INVERSE_DISTANCE_REFERENCE_M = 100;

/**
 * Inverse-distance score in (0,1]: 1 at the epicenter, decays with distance.
 * `referenceMeters` controls how quickly the score drops (larger = slower decay).
 */
export function inverseDistanceScore(
  distanceMeters: number,
  referenceMeters = DEFAULT_INVERSE_DISTANCE_REFERENCE_M
): number {
  const d = Math.max(0, distanceMeters);
  const ref = Math.max(1e-6, referenceMeters);
  return 1 / (1 + d / ref);
}

/** Pacing multiplier from manifest (typically ≥ 0). */
export function pacingTerm(pacingFactor: number): number {
  return Math.max(0, pacingFactor);
}

/** Heading contribution on [0,1]. */
export function headingTerm(headingAlign01: number): number {
  const h = headingAlign01;
  if (Number.isNaN(h)) return 0;
  return Math.min(1, Math.max(0, h));
}

export interface ArbitrationScoreBreakdown {
  pacing: number;
  inverseDistance: number;
  heading: number;
  weighted: number;
  total: number;
}

export function arbitrationScoreBreakdown(
  entry: SpatialEntryContract,
  ctx: ArbitrationScoreContext,
  referenceMeters = DEFAULT_INVERSE_DISTANCE_REFERENCE_M
): ArbitrationScoreBreakdown {
  const { pacingFactor, weights } = entry.arbitration;
  const p = pacingTerm(pacingFactor);
  const inv = inverseDistanceScore(ctx.distanceToEpicenterM, referenceMeters);
  const h = headingTerm(ctx.headingAlign01);
  const weighted = weights.p * 1 + weights.d * inv + weights.h * h;
  const total = p * weighted;
  return {
    pacing: p,
    inverseDistance: inv,
    heading: h,
    weighted,
    total,
  };
}

/**
 * Within-tier score combining pacing, inverse distance, and heading weights (005 US5).
 */
export function arbitrationScore(
  entry: SpatialEntryContract,
  ctx: ArbitrationScoreContext,
  referenceMeters = DEFAULT_INVERSE_DISTANCE_REFERENCE_M
): number {
  return arbitrationScoreBreakdown(entry, ctx, referenceMeters).total;
}
