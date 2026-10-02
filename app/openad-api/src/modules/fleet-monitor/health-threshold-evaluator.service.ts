import { Injectable } from '@nestjs/common';
import type { HealthMetrics } from '@openad/domain';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';

/** Evaluates heartbeat / telemetry health metrics against configured thresholds. */
@Injectable()
export class HealthThresholdEvaluatorService {
  constructor(private readonly cfg: PlatformConfigRuntimeService) {}

  /**
   * Returns `'Flagged'` when any threshold is breached, otherwise `null` (healthy).
   * Caller maps `null` + current `Flagged` → transition to `Active` (recovery).
   */
  evaluate(metrics: HealthMetrics): 'Flagged' | null {
    const c = this.cfg.get();
    const minBat = c.fleetHealth.minBatteryPercent;
    const maxStorage = c.fleetHealth.maxStoragePercent;
    const maxHdop = c.fleetHealth.gpsHdopMax;

    if (metrics.batteryPercentage < minBat) {
      return 'Flagged';
    }
    if (metrics.storageUtilizationPercent > maxStorage) {
      return 'Flagged';
    }
    if (metrics.gpsHdop != null && metrics.gpsHdop > maxHdop) {
      return 'Flagged';
    }
    return null;
  }

  /** First breached dimension for structured logging / FSM detail. */
  breachedField(metrics: HealthMetrics): string | null {
    const c = this.cfg.get();
    const minBat = c.fleetHealth.minBatteryPercent;
    const maxStorage = c.fleetHealth.maxStoragePercent;
    const maxHdop = c.fleetHealth.gpsHdopMax;
    if (metrics.batteryPercentage < minBat) return 'battery';
    if (metrics.storageUtilizationPercent > maxStorage) return 'storage';
    if (metrics.gpsHdop != null && metrics.gpsHdop > maxHdop) return 'gps_hdop';
    return null;
  }
}
