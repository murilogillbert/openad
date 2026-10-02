import { FraudDetectionService } from './fraud-detection.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import type { PlatformConfig } from '@openad/api-contracts';
import type { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';
import { platformConfigDefaults } from '../../platform-config/platform-config.service';

describe('FraudDetectionService', () => {
  describe('static helpers', () => {
    it('impliedSpeedKmh returns null for very short duration', () => {
      expect(
        FraudDetectionService.impliedSpeedKmh({
          latStart: 0,
          lngStart: 0,
          latEnd: 0.01,
          lngEnd: 0.01,
          durationSec: 0.1,
        })
      ).toBeNull();
    });

    it('impliedSpeedKmh computes km/h from WGS84 distance over duration', () => {
      const v = FraudDetectionService.impliedSpeedKmh({
        latStart: 0,
        lngStart: 0,
        latEnd: 0,
        lngEnd: 0.01,
        durationSec: 3600,
      });
      expect(v).not.toBeNull();
      if (v == null) {
        throw new Error('expected speed');
      }
      expect(v).toBeGreaterThan(0);
    });

    it('heartbeatRatioMetric compares telemetry count to expected density', () => {
      const r = FraudDetectionService.heartbeatRatioMetric({
        telemetryCount: 10,
        durationSec: 300,
        expectedIntervalSec: 30,
      });
      expect(r).toBeCloseTo(10 / 10, 5);
    });
  });

  describe('applyFraudRules', () => {
    const deviceId = 'd1111111-1111-4111-8111-111111111111';
    const uniqueEventId = 'e2222222-2222-4222-8222-222222222222';

    function makeSut(overrides: {
      doc?: Record<string, unknown> | null;
      telemetryRows?: unknown[];
    }) {
      const findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(overrides.doc ?? null),
        }),
      });
      const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
      const xrange = jest
        .fn()
        .mockResolvedValue(overrides.telemetryRows ?? []);
      const redis = {
        getClient: () => ({ xrange }),
      };
      const cfg: Pick<PlatformConfigRuntimeService, 'get'> = {
        get: () => {
          const d = platformConfigDefaults();
          return {
            ...d,
            // Teto alto de proposito: o teste exercita a regra de velocidade.
            analytics: { ...d.analytics, maxVelocityKmh: 200 },
          } satisfies PlatformConfig;
        },
      };
      return {
        svc: new FraudDetectionService(
          { findOne, updateOne } as never,
          redis as unknown as RedisService,
          cfg as any
        ),
        findOne,
        updateOne,
        xrange,
      };
    }

    it('no-ops when play row missing', async () => {
      const { svc, updateOne } = makeSut({ doc: null });
      await svc.applyFraudRules(deviceId, uniqueEventId);
      expect(updateOne).not.toHaveBeenCalled();
    });

    it('sets blackout when display too dark and row was billable', async () => {
      const doc = {
        deviceId,
        uniqueEventId,
        reconciliationStatus: 'billable',
        billable: true,
        displayLux: 2,
        latStart: 0,
        lngStart: 0,
        latEnd: 0,
        lngEnd: 0,
        timestampStart: new Date('2026-04-05T10:00:00Z'),
        timestampEnd: new Date('2026-04-05T10:00:30Z'),
      };
      const { svc, updateOne } = makeSut({
        doc,
        telemetryRows: [
          [
            'id',
            ['deviceId', deviceId, 'x', '1'],
          ],
        ],
      });
      await svc.applyFraudRules(deviceId, uniqueEventId);
      expect(updateOne).toHaveBeenCalledWith(
        { deviceId, uniqueEventId },
        {
          $set: expect.objectContaining({
            reconciliationStatus: 'blackout',
            billable: false,
            impliedSpeedKmh: 0,
          }),
        }
      );
    });

    it('sets fraud_velocity when implied speed exceeds max', async () => {
      const doc = {
        deviceId,
        uniqueEventId,
        reconciliationStatus: 'billable',
        billable: true,
        displayLux: 100,
        latStart: 0,
        lngStart: 0,
        latEnd: 10,
        lngEnd: 10,
        timestampStart: new Date('2026-04-05T10:00:00Z'),
        timestampEnd: new Date('2026-04-05T10:00:35Z'),
      };
      const { svc, updateOne } = makeSut({
        doc,
        telemetryRows: [
          [
            'id',
            ['deviceId', deviceId],
          ],
        ],
      });
      await svc.applyFraudRules(deviceId, uniqueEventId);
      const set = (updateOne.mock.calls[0]?.[1] as { $set: Record<string, unknown> })
        .$set;
      expect(set['reconciliationStatus']).toBe('fraud_velocity');
      expect(set['billable']).toBe(false);
      expect(typeof set['impliedSpeedKmh']).toBe('number');
    });
  });
});
