import { Injectable } from '@angular/core';

/** Matches MQTT `syncWindows` / admin API shape (ruleId optional on wire). */
export interface SyncWindowRuleLike {
  startTime: string;
  endTime: string;
  daysOfWeek: number[];
  sizeThresholdMb: number;
}

function parseHHmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/**
 * Returns whether `now` falls inside any rule's day + time window.
 */
export function isWithinAnySyncWindow(
  rules: SyncWindowRuleLike[] | undefined,
  now: Date
): boolean {
  if (!rules?.length) {
    return true;
  }
  const dow = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const r of rules) {
    if (!r.daysOfWeek.includes(dow)) {
      continue;
    }
    const a = parseHHmmToMinutes(r.startTime);
    const b = parseHHmmToMinutes(r.endTime);
    if (a <= b) {
      if (mins >= a && mins <= b) {
        return true;
      }
    } else {
      if (mins >= a || mins <= b) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Large downloads (above the smallest rule threshold) are deferred until a sync window.
 */
@Injectable({ providedIn: 'root' })
export class SyncWindowSchedulerService {
  allowsDownload(
    sizeBytes: number,
    rules: SyncWindowRuleLike[] | undefined,
    now: Date,
    opts?: { bypassWindow?: boolean }
  ): boolean {
    if (opts?.bypassWindow) {
      return true;
    }
    if (!rules?.length) {
      return true;
    }
    const minThresholdMb = Math.min(...rules.map((r) => r.sizeThresholdMb));
    const sizeMb = sizeBytes / (1024 * 1024);
    if (sizeMb <= minThresholdMb) {
      return true;
    }
    return isWithinAnySyncWindow(rules, now);
  }
}
