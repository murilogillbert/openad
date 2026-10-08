import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlatformConfigDoc, PlatformConfigDocument } from './schemas/platform-config.schema';
import type { PlatformConfig } from '@openad/api-contracts';

/**
 * Configuracao padrao da plataforma.
 *
 * Funcao pura, fora da classe, para que teste possa partir dela com `spread` em vez de
 * reescrever o objeto inteiro. Quando era so metodo de instancia, quatro specs mantinham
 * copias literais do objeto e todas quebravam a cada campo novo — foi o que aconteceu ao
 * acrescentar `monetization`.
 */
export function platformConfigDefaults(): PlatformConfig {
  return {
      dashboard: {
        mediaStorageQuotaBytes: null,
      },
      mediaLimits: {
        maxVideoBytes: 524_288_000,
        maxDurationSeconds: 120,
        maxWidth: 1920,
        maxHeight: 1080,
      },
      fleetHealth: {
        minBatteryPercent: 10,
        maxStoragePercent: 95,
        gpsHdopMax: 5,
        heartbeatFlaggedThresholdMs: 180_000,
      },
      analytics: {
        enabled: true,
        maxVelocityKmh: 100,
        playBatchMaxBytes: 5_242_880,
        reconFullPlayMinRatio: 0.9,
        reconMinDurationSec: 3,
        fraudBlackoutMaxLux: 5,
        fraudHeartbeatIntervalSec: 30,
        fraudHeartbeatMinRatio: 0.25,
      },
      monetization: {
        // R$ 0,003 por segundo de tela. Ver `monetization/pricing.policy.ts` para por que a
        // unidade e micro-real e nao centavo.
        pricePerSecondMicros: 3_000,
        imageDisplaySeconds: 15,
        driverPayoutMinPercent: 0.3,
        driverPayoutMaxPercent: 0.8,
        creditCycleMinutes: 15,
        driverPayoutAuctionWeight: 0.5,
        // Conservador: sem risco de caixa ate alguem decidir antecipar pelo painel.
        driverPayoutSettlement: 'store_cycle',
        storeCycleSettlementDays: 45,
      },
  };
}

@Injectable()
export class PlatformConfigService {
  constructor(
    @InjectModel(PlatformConfigDoc.name)
    private readonly model: Model<PlatformConfigDocument>
  ) {}

  defaults(): PlatformConfig {
    return platformConfigDefaults();
  }

  async getOrCreateDefaults(): Promise<PlatformConfigDocument> {
    const existing = await this.model.findOne({ key: 'fleet' }).exec();
    if (existing) return existing;
    return this.model.create({
      key: 'fleet',
      version: 1,
      config: this.defaults() as unknown as Record<string, unknown>,
    });
  }

  mergeWithDefaults(partial: unknown): PlatformConfig {
    const d = this.defaults();
    const p = (partial ?? {}) as any;
    return {
      dashboard: { ...d.dashboard, ...(p.dashboard ?? {}) },
      mediaLimits: { ...d.mediaLimits, ...(p.mediaLimits ?? {}) },
      fleetHealth: { ...d.fleetHealth, ...(p.fleetHealth ?? {}) },
      analytics: { ...d.analytics, ...(p.analytics ?? {}) },
      monetization: { ...d.monetization, ...(p.monetization ?? {}) },
    };
  }

  async save(params: {
    version: number;
    config: Record<string, unknown>;
  }): Promise<PlatformConfigDocument> {
    const doc = await this.getOrCreateDefaults();
    if (doc.version !== params.version) {
      // naive optimistic concurrency; controller maps to 409.
      throw new Error('VERSION_MISMATCH');
    }
    doc.version = doc.version + 1;
    doc.config = this.mergeWithDefaults(params.config) as unknown as Record<string, unknown>;
    await doc.save();
    return doc;
  }

  async restoreDefaults(params: { version: number }): Promise<PlatformConfigDocument> {
    const doc = await this.getOrCreateDefaults();
    if (doc.version !== params.version) {
      throw new Error('VERSION_MISMATCH');
    }
    doc.version = doc.version + 1;
    doc.config = this.defaults() as unknown as Record<string, unknown>;
    await doc.save();
    return doc;
  }
}

