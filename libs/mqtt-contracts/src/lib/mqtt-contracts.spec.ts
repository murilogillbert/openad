import {
  commandAckPayloadSchema,
  impressionPayloadSchema,
  schedulePayloadSchema,
  serverCommandPayloadSchema,
  telemetryPayloadSchema,
} from './schemas';

describe('mqtt-contracts zod schemas', () => {
  it('parses minimal valid telemetry', () => {
    const parsed = telemetryPayloadSchema.parse({
      ts: new Date().toISOString(),
      location: { lat: 1, lng: 2, accuracyMeters: 5, gpsLocked: true },
      connectivity: { networkType: '5G', signalStrengthDbm: -70 },
      playback: {
        status: 'idle',
        currentAssetId: null,
        currentCampaignId: null,
        errorCode: null,
      },
      device: {
        batteryPercent: 90,
        storageFreeGb: 10,
        cpuLoadPercent: 5,
        memoryUsedPercent: 40,
      },
      alertFlags: [],
    });
    expect(parsed.playback.status).toBe('idle');
  });

  it('parses telemetry with optional nativeExtras', () => {
    const parsed = telemetryPayloadSchema.parse({
      ts: new Date().toISOString(),
      location: { lat: 1, lng: 2, accuracyMeters: 5, gpsLocked: true },
      connectivity: { networkType: 'WiFi', signalStrengthDbm: -65 },
      playback: {
        status: 'idle',
        currentAssetId: null,
        currentCampaignId: null,
        errorCode: null,
      },
      device: {
        batteryPercent: 90,
        storageFreeGb: 10,
        cpuLoadPercent: 5,
        memoryUsedPercent: 40,
      },
      alertFlags: [],
      nativeExtras: {
        compassHeadingDeg: 180,
        ambientLightLux: 120,
        volumePercent: 50,
      },
    });
    expect(parsed.nativeExtras?.volumePercent).toBe(50);
  });

  it('parses impression payload', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const parsed = impressionPayloadSchema.parse({
      eventId: id,
      ts: new Date().toISOString(),
      campaignId: 'c1',
      scheduleRuleId: 'r1',
      assetId: 'a1',
      durationPlayedSeconds: 12,
      location: {
        lat: -23.5,
        lng: -46.6,
        accuracyMeters: 12,
        gpsLocked: true,
      },
    });
    expect(parsed.eventId).toBe(id);
  });

  it('parses command ack', () => {
    const parsed = commandAckPayloadSchema.parse({
      commandId: 'cmd-1',
      status: 'success',
      completedAt: new Date().toISOString(),
      details: null,
    });
    expect(parsed.status).toBe('success');
  });

  it('parses command ack with resultCode', () => {
    const parsed = commandAckPayloadSchema.parse({
      commandId: 'cmd-1',
      status: 'failure',
      completedAt: new Date().toISOString(),
      details: 'upload failed',
      resultCode: 'UPLOAD_FAILED',
    });
    expect(parsed.resultCode).toBe('UPLOAD_FAILED');
  });

  it('parses RESTART server command', () => {
    const parsed = serverCommandPayloadSchema.parse({
      commandId: 'cmd-1',
      type: 'RESTART',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    });
    expect(parsed.type).toBe('RESTART');
  });

  it('parses CLEAR_CACHE server command', () => {
    const parsed = serverCommandPayloadSchema.parse({
      commandId: 'cmd-1',
      type: 'CLEAR_CACHE',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    });
    expect(parsed.type).toBe('CLEAR_CACHE');
  });

  it('parses GET_SCREENSHOT with upload payload', () => {
    const issued = new Date().toISOString();
    const exp = new Date(Date.now() + 60_000).toISOString();
    const parsed = serverCommandPayloadSchema.parse({
      commandId: 'cmd-ss',
      type: 'GET_SCREENSHOT',
      issuedAt: issued,
      expiresAt: exp,
      payload: {
        uploadUrl: 'https://example.com/upload',
        deadlineAt: exp,
        uploadHeaders: { 'x-amz-acl': 'bucket-owner-full-control' },
      },
    });
    expect(parsed.type).toBe('GET_SCREENSHOT');
    if (parsed.type === 'GET_SCREENSHOT') {
      expect(parsed.payload.uploadUrl).toContain('https://');
    }
  });

  it('parses UPGRADE_APP', () => {
    const parsed = serverCommandPayloadSchema.parse({
      commandId: 'c2',
      type: 'UPGRADE_APP',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: {
        apkUrl: 'https://cdn.example.com/app.apk',
        checksumSha256: 'abc'.repeat(10),
      },
    });
    expect(parsed.type).toBe('UPGRADE_APP');
  });

  it('parses SET_VOLUME / SET_BRIGHTNESS', () => {
    for (const type of ['SET_VOLUME', 'SET_BRIGHTNESS'] as const) {
      const parsed = serverCommandPayloadSchema.parse({
        commandId: 'c3',
        type,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        payload: { level: 42 },
      });
      expect(parsed.type).toBe(type);
    }
  });

  it('parses EMERGENCY_SYNC', () => {
    const parsed = serverCommandPayloadSchema.parse({
      commandId: 'c4',
      type: 'EMERGENCY_SYNC',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: { manifestUrl: 'https://api.example.com/m' },
    });
    expect(parsed.type).toBe('EMERGENCY_SYNC');
  });

  it('parses EMERGENCY_SYNC with null payload', () => {
    const parsed = serverCommandPayloadSchema.parse({
      commandId: 'c4',
      type: 'EMERGENCY_SYNC',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    });
    expect(parsed.type).toBe('EMERGENCY_SYNC');
  });

  it('parses schedule payload', () => {
    const parsed = schedulePayloadSchema.parse({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      rules: [
        {
          ruleId: 'rule-1',
          priority: 1,
          assetId: 'a1',
          assetUrl: 'https://example.com/a.bin',
          assetChecksumSha256: 'abc',
          assetVersion: 1,
          geoZones: [
            {
              zoneId: 'z1',
              geometry: { type: 'Polygon', coordinates: [] },
            },
          ],
          timeWindows: [
            {
              daysOfWeek: ['MON'],
              startTime: '07:00',
              endTime: '09:00',
              timezone: 'UTC',
            },
          ],
          dwellThresholdSeconds: 30,
          validUntil: new Date().toISOString(),
        },
      ],
      fallbackAssetId: null,
    });
    expect(parsed.rules).toHaveLength(1);
  });
});
