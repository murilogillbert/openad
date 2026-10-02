import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Subject } from 'rxjs';
import { DeepSleepService } from './deep-sleep.service';
import { MqttClientService } from '../../features/mqtt/services/mqtt-client.service';
import { PowerStateMonitorService } from '../power-state-monitor.service';

vi.mock('@capacitor/device', () => ({
  Device: {
    getBatteryInfo: vi.fn().mockResolvedValue({ batteryLevel: 0.1 }),
  },
}));

describe('DeepSleepService', () => {
  let engineOff: Subject<void>;
  let engineOn: Subject<void>;

  beforeEach(() => {
    engineOff = new Subject<void>();
    engineOn = new Subject<void>();
    TestBed.configureTestingModule({
      providers: [
        DeepSleepService,
        {
          provide: PowerStateMonitorService,
          useValue: {
            engineOff$: engineOff.asObservable(),
            engineOn$: engineOn.asObservable(),
          },
        },
        {
          provide: MqttClientService,
          useValue: {
            isConnected: () => true,
            getActiveDeviceId: () => 'dev-1',
            publishHeartbeat: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    });
  });

  it('enters deep sleep after engine off grace when battery low', async () => {
    vi.useFakeTimers();
    const svc = TestBed.inject(DeepSleepService);
    svc.start();
    engineOff.next();
    expect(svc.inDeepSleep()).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(svc.inDeepSleep()).toBe(true);
    vi.useRealTimers();
  });
});
