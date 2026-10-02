import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PowerStatePluginContract } from '../../capacitor/power-state.plugin';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { POWER_STATE_PLUGIN } from './power-state-plugin.token';
import { PowerStateMonitorService } from './power-state-monitor.service';
import { TABLET_ENV } from './tablet-env.token';

describe('PowerStateMonitorService', () => {
  let listener: (payload: { connected: boolean }) => void;

  const mockPlugin: PowerStatePluginContract = {
    addListener: async (_ev, cb) => {
      listener = cb as (payload: { connected: boolean }) => void;
      return { remove: async () => undefined };
    },
  };

  beforeEach(async () => {
    vi.useFakeTimers();

    TestBed.configureTestingModule({
      providers: [
        PowerStateMonitorService,
        MqttClientService,
        { provide: TABLET_ENV, useValue: { POWER_ENGINE_OFF_GRACE_MS: 500 } },
        { provide: POWER_STATE_PLUGIN, useValue: mockPlugin },
      ],
    });
    await TestBed.inject(PowerStateMonitorService).start();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits engine-off after grace when disconnected', async () => {
    const power = TestBed.inject(PowerStateMonitorService);
    const off: unknown[] = [];
    power.engineOff$.subscribe(() => off.push(true));

    listener({ connected: false });
    await vi.advanceTimersByTimeAsync(499);
    expect(off.length).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(off.length).toBe(1);
  });

  it('cancels engine-off if connected during grace', async () => {
    const power = TestBed.inject(PowerStateMonitorService);
    const off: unknown[] = [];
    power.engineOff$.subscribe(() => off.push(true));

    listener({ connected: false });
    await vi.advanceTimersByTimeAsync(200);
    listener({ connected: true });
    await vi.advanceTimersByTimeAsync(500);
    expect(off.length).toBe(0);
  });

  it('emits engine-on after reconnect post engine-off', async () => {
    const power = TestBed.inject(PowerStateMonitorService);
    const on: unknown[] = [];
    power.engineOn$.subscribe(() => on.push(true));

    listener({ connected: false });
    await vi.advanceTimersByTimeAsync(500);
    listener({ connected: true });
    expect(on.length).toBe(1);
  });
});
