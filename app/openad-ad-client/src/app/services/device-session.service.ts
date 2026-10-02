import { isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import type { HardwareFingerprintComponents } from './hardware-fingerprint.service';
import { PairingEventsService } from './pairing-events.service';

const PAIRED_DEVICE_ID_KEY = 'openad_paired_device_id_v1';
const DEVICE_ACCESS_TOKEN_KEY = 'openad_device_access_token_v1';
const DEVICE_FINGERPRINT_HASH_KEY = 'openad_device_fingerprint_hash_v1';
const PENDING_REGISTRATION_KEY = 'openad_pairing_pending_registration_v1';
const MQTT_FROM_PAIRING_KEY = 'openad_mqtt_from_pairing_v1';

/** Broker login from POST /devices/pairing/bind (per-device RabbitMQ user). */
export interface StoredMqttFromPairing {
  deviceId: string;
  /** May be empty when the server omits the broker URL; client uses build-time `MQTT_URL`. */
  brokerUrl: string;
  username: string;
  password: string;
}

export interface PendingRegistration {
  deviceId: string;
  hardwareFingerprint: HardwareFingerprintComponents;
}

/**
 * Persists bound `deviceId`, device JWT, fingerprint hash, and in-flight pairing state.
 */
@Injectable({ providedIn: 'root' })
export class DeviceSessionService {
  private readonly pairing = inject(PairingEventsService);
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.pairing.pairingComplete$.subscribe((ev) => {
      void Preferences.set({
        key: PAIRED_DEVICE_ID_KEY,
        value: ev.deviceId,
      });
    });
  }

  async getStoredDeviceId(): Promise<string | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const { value } = await Preferences.get({ key: PAIRED_DEVICE_ID_KEY });
    return value ?? null;
  }

  async getAccessToken(): Promise<string | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const { value } = await Preferences.get({ key: DEVICE_ACCESS_TOKEN_KEY });
    return value ?? null;
  }

  async getFingerprintHash(): Promise<string | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const { value } = await Preferences.get({ key: DEVICE_FINGERPRINT_HASH_KEY });
    return value ?? null;
  }

  async savePairingSession(params: {
    deviceId: string;
    accessToken: string;
    fingerprintHash: string;
  }): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    await Preferences.set({
      key: PAIRED_DEVICE_ID_KEY,
      value: params.deviceId,
    });
    await Preferences.set({
      key: DEVICE_ACCESS_TOKEN_KEY,
      value: params.accessToken,
    });
    await Preferences.set({
      key: DEVICE_FINGERPRINT_HASH_KEY,
      value: params.fingerprintHash,
    });
  }

  async saveMqttFromPairing(params: StoredMqttFromPairing): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    await Preferences.set({
      key: MQTT_FROM_PAIRING_KEY,
      value: JSON.stringify(params),
    });
  }

  async getMqttFromPairing(): Promise<StoredMqttFromPairing | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const { value } = await Preferences.get({ key: MQTT_FROM_PAIRING_KEY });
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as StoredMqttFromPairing;
    } catch {
      return null;
    }
  }

  async clearMqttFromPairing(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    await Preferences.remove({ key: MQTT_FROM_PAIRING_KEY });
  }

  async savePendingRegistration(
    deviceId: string,
    hardwareFingerprint: HardwareFingerprintComponents
  ): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const payload: PendingRegistration = { deviceId, hardwareFingerprint };
    await Preferences.set({
      key: PENDING_REGISTRATION_KEY,
      value: JSON.stringify(payload),
    });
  }

  async getPendingRegistration(): Promise<PendingRegistration | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const { value } = await Preferences.get({ key: PENDING_REGISTRATION_KEY });
    if (!value) {
      return null;
    }
    try {
      return JSON.parse(value) as PendingRegistration;
    } catch {
      return null;
    }
  }

  async clearPendingRegistration(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    await Preferences.remove({ key: PENDING_REGISTRATION_KEY });
  }
}
