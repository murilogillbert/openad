import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  PairingBindResponse,
  PairingRegisterResponse,
} from '@openad/api-contracts';
import { firstValueFrom } from 'rxjs';
import { DeviceFleetContextService } from './device-fleet-context.service';
import { DeviceSessionService } from './device-session.service';
import { HardwareFingerprintService } from './hardware-fingerprint.service';
import { PairingEventsService } from './pairing-events.service';
import { TABLET_ENV, type TabletEnv } from './tablet-env.token';

@Injectable({ providedIn: 'root' })
export class PairingApiService {
  private readonly http = inject(HttpClient);
  private readonly env = inject<TabletEnv>(TABLET_ENV);
  private readonly hw = inject(HardwareFingerprintService);
  private readonly session = inject(DeviceSessionService);
  private readonly fleetContext = inject(DeviceFleetContextService);
  private readonly pairingEvents = inject(PairingEventsService);

  private url(path: string): string {
    const base = this.env.API_BASE_URL?.replace(/\/$/, '') ?? '';
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }

  /** POST /devices/pairing/register — stores pending registration for bind. */
  async register(): Promise<PairingRegisterResponse> {
    const raw = await this.hw.collect();
    const hardwareFingerprint =
      'flag' in raw
        ? {
            imei: null as string | null,
            serialNumber: 'UNAVAILABLE',
            macAddress: '00:00:00:00:00:01',
          }
        : raw;

    const res = await firstValueFrom(
      this.http.post<PairingRegisterResponse>(this.url('/devices/pairing/register'), {
        hardwareFingerprint,
      })
    );
    await this.session.savePendingRegistration(res.deviceId, hardwareFingerprint);
    return res;
  }

  /** POST /devices/pairing/bind — persists JWT + hash, emits pairing complete. */
  async bind(secretCode: string): Promise<PairingBindResponse> {
    const pending = await this.session.getPendingRegistration();
    if (!pending) {
      throw new Error('No pending pairing — call register() first');
    }
    const normalized = secretCode.trim().toUpperCase();
    const res = await firstValueFrom(
      this.http.post<PairingBindResponse>(this.url('/devices/pairing/bind'), {
        deviceId: pending.deviceId,
        hardwareFingerprint: pending.hardwareFingerprint,
        secretCode: normalized,
      })
    );
    const fpHash = await this.hw.hashFingerprint(pending.hardwareFingerprint);
    await this.session.savePairingSession({
      deviceId: res.deviceId,
      accessToken: res.accessToken,
      fingerprintHash: fpHash,
    });
    await this.session.saveMqttFromPairing({
      deviceId: res.deviceId,
      brokerUrl: res.mqtt.brokerUrl?.trim() ?? '',
      username: res.mqtt.username,
      password: res.mqtt.password,
    });
    await this.session.clearPendingRegistration();
    void this.fleetContext.refreshBoundVehicle();
    this.pairingEvents.emitPairingComplete(res.deviceId);
    return res;
  }
}
