import { ImpressionEventSchema } from './impression-event.schema';

/**
 * FR-008: vehicle-scoped analytics must stay stable across hardware swap (same `vehicleId`,
 * different `deviceId` over time). Persisted impressions anchor billing and reach on `vehicleId`.
 */
describe('ImpressionEventRecord (FR-008)', () => {
  it('persists impressions with vehicleId as the durable roster key (with deviceId)', () => {
    expect(ImpressionEventSchema.paths).toHaveProperty('vehicleId');
    expect(ImpressionEventSchema.paths).toHaveProperty('deviceId');
  });
});
