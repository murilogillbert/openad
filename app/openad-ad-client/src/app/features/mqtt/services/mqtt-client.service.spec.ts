import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { EMPTY } from 'rxjs';
import { MqttClientService } from './mqtt-client.service';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PairingEventsService } from '../../../services/pairing-events.service';
import { TABLET_ENV } from '../../../services/tablet-env.token';

describe('MqttClientService (features/mqtt)', () => {
  it('is created with MqttModule providers', () => {
    TestBed.configureTestingModule({
      providers: [
        MqttClientService,
        { provide: TABLET_ENV, useValue: {} },
        {
          provide: PairingEventsService,
          useValue: { pairingComplete$: EMPTY },
        },
        {
          provide: DeviceSessionService,
          useValue: {
            getMqttFromPairing: () => Promise.resolve(null),
          },
        },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
    const svc = TestBed.inject(MqttClientService);
    expect(svc).toBeTruthy();
    expect(svc.isConnected()).toBe(false);
  });
});
