import { spatialEntrySchema, spatialManifestSchema } from './spatial-manifest.contract';

describe('spatial-manifest.contract', () => {
  it('round-trips a circle spatial entry', () => {
    const sample = {
      zoneId: '550e8400-e29b-41d4-a716-446655440000',
      tier: 'T2' as const,
      priorityScore: 10,
      geometry: {
        type: 'Circle' as const,
        center: { lng: -46.63, lat: -23.55 },
        radiusMeters: 500,
      },
      mediaId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      trigger: { mode: 'dwell' as const, dwellSeconds: 30 },
      rotation: 'sequential' as const,
      arbitration: {
        pacingFactor: 1,
        weights: { p: 0.4, d: 0.35, h: 0.25 },
      },
      hysteresisExitMeters: 25,
      cooldownSeconds: 120,
    };
    const parsed = spatialEntrySchema.parse(sample);
    expect(parsed.geometry.type).toBe('Circle');
  });

  it('round-trips spatial manifest', () => {
    const manifest = {
      version: '2026-04-05T12:00:00.000Z',
      entries: [],
    };
    expect(spatialManifestSchema.parse(manifest).entries).toEqual([]);
  });
});
