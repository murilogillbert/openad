import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayRecordBufferService } from './play-record-buffer.service';
import type { PlayRecordPayload } from '@openad/api-contracts';

const basePlay = (): PlayRecordPayload => ({
  uniqueEventId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  deviceId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  vehicleId: 'cccccccc-cccc-4ccc-cccc-cccccccccccc',
  campaignId: 'dddddddd-dddd-4ddd-dddd-dddddddddddd',
  timestampStart: '2026-04-05T12:00:00.000Z',
  timestampEnd: '2026-04-05T12:00:30.000Z',
  latStart: 0,
  lngStart: 0,
  latEnd: 0,
  lngEnd: 0,
  triggerReason: 'Standard_Loop',
  batteryLevel: 90,
  networkType: '5G',
  gpsAccuracyM: 10,
});

describe('PlayRecordBufferService', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal(
      'localStorage',
      {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      } as Storage
    );
    TestBed.configureTestingModule({
      providers: [
        PlayRecordBufferService,
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('enqueuePlay appends and peekPendingNotUploaded returns only pending', async () => {
    const svc = TestBed.inject(PlayRecordBufferService);
    await svc.enqueuePlay(basePlay());
    await svc.enqueuePlay({
      ...basePlay(),
      uniqueEventId: 'eeeeeeee-eeee-4eee-eeee-eeeeeeeeeeee',
    });
    const pending = await svc.peekPendingNotUploaded(10);
    expect(pending).toHaveLength(2);
    expect(pending.every((p) => p.uploaded === 0)).toBe(true);
  });

  it('markUploaded flips uploaded flag for matching ids', async () => {
    const svc = TestBed.inject(PlayRecordBufferService);
    const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    await svc.enqueuePlay(basePlay());
    await svc.markUploaded([id]);
    const pending = await svc.peekPendingNotUploaded(10);
    expect(pending).toHaveLength(0);
  });

  it('caps store at 2000 plays (oldest dropped)', async () => {
    const svc = TestBed.inject(PlayRecordBufferService);
    for (let i = 0; i < 2001; i += 1) {
      await svc.enqueuePlay({
        ...basePlay(),
        uniqueEventId: `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
      });
    }
    const raw = globalThis.localStorage?.getItem('openad_analytics_pending_plays_v1');
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { plays: unknown[] };
    expect(parsed.plays.length).toBe(2000);
  });
});
