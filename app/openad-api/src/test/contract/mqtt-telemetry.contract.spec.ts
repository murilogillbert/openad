import {
  commandAckPayloadSchema,
  telemetryPayloadSchema,
} from '@openad/mqtt-contracts';

describe('MQTT telemetry + command ack payloads (contract)', () => {
  it('validates openad/{deviceId}/telemetry payload', () => {
    const payload = {
      ts: new Date().toISOString(),
      location: {
        lat: 51.5,
        lng: -0.12,
        accuracyMeters: 12,
        gpsLocked: true,
      },
      connectivity: {
        networkType: '5G' as const,
        signalStrengthDbm: -70,
      },
      playback: {
        status: 'idle' as const,
        currentAssetId: null,
        currentCampaignId: null,
        errorCode: null,
      },
      device: {
        batteryPercent: 90,
        storageFreeGb: 4,
        cpuLoadPercent: 12,
        memoryUsedPercent: 40,
      },
      alertFlags: [] as [],
    };

    const parsed = telemetryPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('validates openad/{deviceId}/commands/ack payload', () => {
    const payload = {
      commandId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'success' as const,
      completedAt: new Date().toISOString(),
      details: null,
    };

    const parsed = commandAckPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });
});
