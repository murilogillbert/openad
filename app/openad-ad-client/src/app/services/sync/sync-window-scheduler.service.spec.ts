import { describe, it, expect } from 'vitest';
import {
  isWithinAnySyncWindow,
  SyncWindowSchedulerService,
} from './sync-window-scheduler.service';

describe('isWithinAnySyncWindow', () => {
  it('returns true when no rules', () => {
    expect(isWithinAnySyncWindow(undefined, new Date('2026-04-05T12:00:00'))).toBe(
      true
    );
  });

  it('matches same-day window', () => {
    const rules = [
      {
        startTime: '09:00',
        endTime: '17:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        sizeThresholdMb: 50,
      },
    ];
    expect(
      isWithinAnySyncWindow(rules, new Date('2026-04-05T10:00:00'))
    ).toBe(true);
    expect(
      isWithinAnySyncWindow(rules, new Date('2026-04-05T08:00:00'))
    ).toBe(false);
  });

  it('matches overnight window', () => {
    const rules = [
      {
        startTime: '22:00',
        endTime: '06:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        sizeThresholdMb: 10,
      },
    ];
    expect(
      isWithinAnySyncWindow(rules, new Date('2026-04-05T23:00:00'))
    ).toBe(true);
    expect(
      isWithinAnySyncWindow(rules, new Date('2026-04-05T05:00:00'))
    ).toBe(true);
    expect(
      isWithinAnySyncWindow(rules, new Date('2026-04-05T12:00:00'))
    ).toBe(false);
  });
});

describe('SyncWindowSchedulerService', () => {
  it('gates large downloads outside window', () => {
    const svc = new SyncWindowSchedulerService();
    const rules = [
      {
        startTime: '09:00',
        endTime: '17:00',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        sizeThresholdMb: 5,
      },
    ];
    const noon = new Date('2026-04-05T12:00:00');
    const small = 4 * 1024 * 1024;
    const large = 10 * 1024 * 1024;
    expect(svc.allowsDownload(small, rules, noon)).toBe(true);
    expect(svc.allowsDownload(large, rules, noon)).toBe(true);
    const night = new Date('2026-04-05T20:00:00');
    expect(svc.allowsDownload(large, rules, night)).toBe(false);
    expect(
      svc.allowsDownload(large, rules, night, { bypassWindow: true })
    ).toBe(true);
  });
});
