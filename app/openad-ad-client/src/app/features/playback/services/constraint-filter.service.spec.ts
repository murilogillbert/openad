import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ConstraintFilterService, pointInRing } from './constraint-filter.service';

describe('ConstraintFilterService', () => {
  let svc: ConstraintFilterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ConstraintFilterService],
    });
    svc = TestBed.inject(ConstraintFilterService);
  });

  it('pointInRing detects inside a square', () => {
    const ring = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ];
    expect(pointInRing(0.5, 0.5, ring)).toBe(true);
    expect(pointInRing(2, 2, ring)).toBe(false);
  });

  it('passes through manifest items (campaign-level targeting)', () => {
    const media = [
      {
        mediaId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        hash: 'x',
        priority: 1,
        downloadUrl: 'u',
        fileSize: 1,
        duration: 1,
      },
    ];
    expect(
      svc.filter(media, {
        latitude: 5,
        longitude: 5,
        timestamp: '2020-01-01T12:00:00.000Z',
      })
    ).toEqual(media);
  });
});
