import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { PlayerRestartScheduler } from './player-restart.scheduler';
import { AdPlaybackService } from '../ad-playback.service';
import { PlaybackEngineService } from '../../features/playback/services/playback-engine.service';
import { DeepSleepService } from './deep-sleep.service';

describe('PlayerRestartScheduler', () => {
  it('skips when deep sleep active', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [
        PlayerRestartScheduler,
        {
          provide: AdPlaybackService,
          useValue: {
            playbackPaused: signal(true),
          },
        },
        {
          provide: PlaybackEngineService,
          useValue: {
            adLoopActive: () => false,
          },
        },
        {
          provide: DeepSleepService,
          useValue: {
            inDeepSleep: () => true,
          },
        },
      ],
    });
    const svc = TestBed.inject(PlayerRestartScheduler);
    (svc as unknown as { check: () => void }).check();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
