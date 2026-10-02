import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { LoopManagerService } from './loop-manager.service';

describe('LoopManagerService', () => {
  let svc: LoopManagerService;

  const a = {
    mediaId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    hash: 'h',
    priority: 10,
    downloadUrl: 'u',
    fileSize: 1,
    duration: 1,
  };
  const b = {
    mediaId: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff',
    hash: 'h',
    priority: 20,
    downloadUrl: 'u',
    fileSize: 1,
    duration: 1,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LoopManagerService],
    });
    svc = TestBed.inject(LoopManagerService);
  });

  it('commitPlayed makes the next selectNext avoid repeating the same id when alternatives exist', () => {
    const first = svc.selectNext([a, b]);
    expect(first).not.toBeNull();
    svc.commitPlayed(first!);
    const second = svc.selectNext([a, b]);
    expect(second?.mediaId).not.toBe(first!.mediaId);
  });
});
