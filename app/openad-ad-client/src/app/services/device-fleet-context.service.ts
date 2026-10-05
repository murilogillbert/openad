import { isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import type { DeviceSessionResponse } from '@openad/api-contracts';
import { ApiClientService } from './api-client.service';
import { DeviceSessionService } from './device-session.service';

const BOUND_VEHICLE_CACHE_KEY = 'openad_bound_vehicle_id_v1';

/**
 * Caches fleet binding context from the API (bound vehicle) for analytics and telemetry.
 */
@Injectable({ providedIn: 'root' })
export class DeviceFleetContextService {
  private readonly api = inject(ApiClientService);
  private readonly session = inject(DeviceSessionService);
  private readonly platformId = inject(PLATFORM_ID);

  /** Latest cached value (may be stale until {@link refreshBoundVehicle} runs). */
  async getCachedBoundVehicleId(): Promise<string | null> {
    if (!isPlatformBrowser(this.platformId)) {
      return null;
    }
    const { value } = await Preferences.get({ key: BOUND_VEHICLE_CACHE_KEY });
    return value ?? null;
  }

  /**
   * Fetches `/devices/:id/session` and updates the cache. Call after pairing and on manifest sync.
   */
  async refreshBoundVehicle(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const deviceId = await this.session.getStoredDeviceId();
    if (!deviceId) {
      await Preferences.remove({ key: BOUND_VEHICLE_CACHE_KEY });
      return;
    }
    try {
      const res = await this.api.getWithAuth<DeviceSessionResponse>(
        // Sem `/api/v1`: `API_BASE_URL` ja inclui o prefixo. Repetido, dava 404.
        `/devices/${encodeURIComponent(deviceId)}/session`
      );
      if (res.boundVehicleId) {
        await Preferences.set({
          key: BOUND_VEHICLE_CACHE_KEY,
          value: res.boundVehicleId,
        });
      } else {
        await Preferences.remove({ key: BOUND_VEHICLE_CACHE_KEY });
      }
    } catch {
      /* offline or auth gap — keep last known cache */
    }
  }

  /**
   * Returns a bound vehicle id when known: uses cache, then tries one refresh if empty.
   */
  async resolveBoundVehicleId(): Promise<string | null> {
    const cached = await this.getCachedBoundVehicleId();
    if (cached) {
      return cached;
    }
    await this.refreshBoundVehicle();
    return this.getCachedBoundVehicleId();
  }
}
