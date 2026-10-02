import { impressionPayloadSchema } from '@openad/mqtt-contracts';

describe('MQTT impressions payload (contract)', () => {
  it('requires eventId, ts, campaignId, location.gpsLocked', () => {
    const payload = {
      eventId: '550e8400-e29b-41d4-a716-446655440000',
      ts: new Date().toISOString(),
      campaignId: '660e8400-e29b-41d4-a716-446655440001',
      scheduleRuleId: '770e8400-e29b-41d4-a716-446655440002',
      assetId: '880e8400-e29b-41d4-a716-446655440003',
      durationPlayedSeconds: 12,
      location: {
        lat: -23.5,
        lng: -46.6,
        accuracyMeters: 20,
        gpsLocked: true,
      },
    };

    const parsed = impressionPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});
