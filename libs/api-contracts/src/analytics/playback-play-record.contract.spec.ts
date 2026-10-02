import { gzipSync, gunzipSync } from 'zlib';
import {
  playBatchSchema,
  playRecordSchema,
} from './playback-play-record.contract';

describe('playback-play-record.contract', () => {
  const basePlay = {
    uniqueEventId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    deviceId: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    vehicleId: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
    campaignId: '6ba7b813-9dad-11d1-80b4-00c04fd430c8',
    timestampStart: '2026-04-05T12:00:00.000Z',
    timestampEnd: '2026-04-05T12:00:15.000Z',
    latStart: -23.55,
    lngStart: -46.63,
    latEnd: -23.551,
    lngEnd: -46.631,
    triggerReason: 'Standard_Loop' as const,
    batteryLevel: 80,
    networkType: '5G',
    gpsAccuracyM: 12,
  };

  it('round-trips a play record', () => {
    const parsed = playRecordSchema.parse(basePlay);
    expect(parsed.triggerReason).toBe('Standard_Loop');
  });

  it('round-trips a batch envelope', () => {
    const batch = {
      schemaVersion: 1 as const,
      batchId: '7ba7b810-9dad-11d1-80b4-00c04fd430c8',
      deviceId: basePlay.deviceId,
      plays: [basePlay],
    };
    const parsed = playBatchSchema.parse(batch);
    expect(parsed.plays).toHaveLength(1);
  });

  it('round-trips batch JSON after gzip transport (gzip → gunzip → Zod)', () => {
    const batch = {
      schemaVersion: 1 as const,
      batchId: '7ba7b810-9dad-11d1-80b4-00c04fd430c8',
      deviceId: basePlay.deviceId,
      plays: [basePlay],
    };
    const gz = gzipSync(Buffer.from(JSON.stringify(batch), 'utf8'));
    const json = JSON.parse(gunzipSync(gz).toString('utf8'));
    expect(playBatchSchema.parse(json).batchId).toBe(batch.batchId);
  });
});
