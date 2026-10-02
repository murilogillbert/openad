import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { ShadowQueueService } from './shadow-queue.service';

function minimalEntry(mediaId: string): SpatialEntryContract {
  return {
    zoneId: '550e8400-e29b-41d4-a716-446655440000',
    tier: 'T4',
    priorityScore: 1,
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    },
    mediaId,
    trigger: { mode: 'entry' },
    rotation: 'sequential',
    arbitration: { pacingFactor: 1, weights: { p: 1, d: 1, h: 1 } },
  };
}

describe('ShadowQueueService', () => {
  let svc: ShadowQueueService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(ShadowQueueService);
    svc.clear();
  });

  it('refreshAndDrain returns queued entries and clears the queue', () => {
    const a = minimalEntry('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    svc.enqueue(a, 0, 0);
    expect(svc.size()).toBe(1);
    const out = svc.refreshAndDrain();
    expect(out.length).toBe(1);
    expect(svc.size()).toBe(0);
  });

  it('deduplicates by mediaId on enqueue', () => {
    const a = minimalEntry('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    svc.enqueue(a, 0, 0);
    svc.enqueue(a, 0, 0);
    expect(svc.size()).toBe(1);
  });

  it('noteTrajectory drains after sufficient movement from anchor', () => {
    const a = minimalEntry('6ba7b810-9dad-11d1-80b4-00c04fd430c8');
    svc.enqueue(a, -46.6, -23.5);
    const near = svc.noteTrajectory(-46.6001, -23.5, 500);
    expect(near).toHaveLength(0);
    const far = svc.noteTrajectory(-46.62, -23.5, 500);
    expect(far).toHaveLength(1);
  });
});
