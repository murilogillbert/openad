import type { HealthMetrics } from '@openad/domain';
import { HealthThresholdEvaluatorService } from './health-threshold-evaluator.service';
import type { PlatformConfig } from '@openad/api-contracts';
import type { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';

function metrics(partial: Partial<HealthMetrics>): HealthMetrics {
  return {
    batteryPercentage: 50,
    storageUtilizationPercent: 50,
    gpsHdop: 2,
    gpsLocked: true,
    reportedAt: new Date().toISOString(),
    ...partial,
  };
}

describe('HealthThresholdEvaluatorService', () => {
  const cfg: Pick<PlatformConfigRuntimeService, 'get'> = {
    get: () =>
      ({
        dashboard: { mediaStorageQuotaBytes: null },
        mediaLimits: {
          maxVideoBytes: 1,
          maxDurationSeconds: 1,
          maxWidth: 1,
          maxHeight: 1,
        },
        fleetHealth: {
          minBatteryPercent: 10,
          maxStoragePercent: 95,
          gpsHdopMax: 5,
          heartbeatFlaggedThresholdMs: 180_000,
        },
        analytics: {
          enabled: true,
          maxVelocityKmh: 200,
          playBatchMaxBytes: 5_242_880,
          reconFullPlayMinRatio: 0.9,
          reconMinDurationSec: 3,
          fraudBlackoutMaxLux: 5,
          fraudHeartbeatIntervalSec: 30,
          fraudHeartbeatMinRatio: 0.25,
        },
      }) satisfies PlatformConfig,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns Flagged when battery below min (9% vs min 10%)', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(svc.evaluate(metrics({ batteryPercentage: 9 }))).toBe('Flagged');
  });

  it('returns null at battery boundary (10% vs min 10%)', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(svc.evaluate(metrics({ batteryPercentage: 10 }))).toBeNull();
  });

  it('returns Flagged when storage utilization above max (96% vs max 95%)', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(svc.evaluate(metrics({ storageUtilizationPercent: 96 }))).toBe(
      'Flagged'
    );
  });

  it('returns null at storage boundary (95% vs max 95%)', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(svc.evaluate(metrics({ storageUtilizationPercent: 95 }))).toBeNull();
  });

  it('returns Flagged when HDOP above max (5.1 vs max 5)', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(svc.evaluate(metrics({ gpsHdop: 5.1 }))).toBe('Flagged');
  });

  it('returns null at HDOP boundary (5.0 vs max 5)', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(svc.evaluate(metrics({ gpsHdop: 5.0 }))).toBeNull();
  });

  it('returns null when all metrics healthy', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(
      svc.evaluate(
        metrics({
          batteryPercentage: 80,
          storageUtilizationPercent: 40,
          gpsHdop: 2,
        })
      )
    ).toBeNull();
  });

  it('ignores gpsHdop threshold when gpsHdop is null', () => {
    const svc = new HealthThresholdEvaluatorService(cfg as any);
    expect(svc.evaluate(metrics({ gpsHdop: null }))).toBeNull();
  });
});
