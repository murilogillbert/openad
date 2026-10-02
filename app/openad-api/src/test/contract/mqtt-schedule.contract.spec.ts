import { schedulePayloadSchema } from '@openad/mqtt-contracts';

describe('MQTT schedule payload (contract)', () => {
  it('matches Zod schema with rules[], assetChecksumSha256, nested geoZones and timeWindows', () => {
    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      rules: [
        {
          ruleId: '550e8400-e29b-41d4-a716-446655440000',
          priority: 1,
          assetId: '660e8400-e29b-41d4-a716-446655440001',
          assetUrl: 'http://127.0.0.1:3000/api/v1/campaigns/x/assets/y/file',
          assetChecksumSha256: 'a'.repeat(64),
          assetVersion: 1,
          geoZones: [
            {
              zoneId: 'z1',
              geometry: {
                type: 'Polygon',
                coordinates: [
                  [
                    [0, 0],
                    [1, 0],
                    [1, 1],
                    [0, 1],
                    [0, 0],
                  ],
                ],
              },
            },
          ],
          timeWindows: [
            {
              daysOfWeek: ['MON'],
              startTime: '07:00',
              endTime: '09:00',
              timezone: 'America/Sao_Paulo',
            },
          ],
          dwellThresholdSeconds: 30,
          validUntil: new Date().toISOString(),
        },
      ],
      fallbackAssetId: null,
    };

    const parsed = schedulePayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});
