/**
 * Concurrent JSON play-batch posts (ingest path only). See README.md.
 */
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const deviceId = process.env.DEVICE_ID;
const token = process.env.DEVICE_JWT;
const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? 20));
const total = Math.max(1, Number(process.env.REQUESTS ?? 100));

if (!deviceId || !token) {
  console.error('Set DEVICE_ID and DEVICE_JWT');
  process.exit(2);
}

const path = `/api/v1/devices/${encodeURIComponent(deviceId)}/analytics/play-batches`;

function oneBatch() {
  const batchId = randomUUID();
  const uniqueEventId = randomUUID();
  const campaignId = randomUUID();
  const vehicleId = randomUUID();
  const body = {
    schemaVersion: 1,
    batchId,
    deviceId,
    plays: [
      {
        uniqueEventId,
        deviceId,
        vehicleId,
        campaignId,
        timestampStart: '2026-04-05T12:00:00.000Z',
        timestampEnd: '2026-04-05T12:00:15.000Z',
        latStart: -23.55,
        lngStart: -46.63,
        latEnd: -23.551,
        lngEnd: -46.631,
        triggerReason: 'Standard_Loop',
        batteryLevel: 80,
        networkType: '5G',
        gpsAccuracyM: 12,
        displayLux: 400,
      },
    ],
  };
  return fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

let ok = 0;
let fail = 0;
let i = 0;

async function worker() {
  while (i < total) {
    const n = i++;
    try {
      const res = await oneBatch();
      if (res.status === 202) {
        ok += 1;
      } else {
        fail += 1;
        const t = await res.text();
        console.error(`req ${n} -> ${res.status}`, t.slice(0, 200));
      }
    } catch (e) {
      fail += 1;
      console.error(`req ${n} error`, e);
    }
  }
}

const t0 = Date.now();
await Promise.all(Array.from({ length: concurrency }, () => worker()));
const ms = Date.now() - t0;
console.log(
  JSON.stringify({
    event: 'analytics.ingest_load.done',
    baseUrl,
    concurrency,
    requests: total,
    accepted202: ok,
    failed: fail,
    durationMs: ms,
  })
);
process.exit(fail > 0 ? 1 : 0);
