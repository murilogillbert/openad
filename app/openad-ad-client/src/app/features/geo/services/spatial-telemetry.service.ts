import { Injectable, inject } from '@angular/core';
import type { SpatialLedgerBatch } from '@openad/mqtt-contracts';
import { DeviceSessionService } from '../../../services/device-session.service';
import { MqttClientService } from '../../mqtt/services/mqtt-client.service';

export type LostOpportunityReason =
  | 'higher_tier'
  | 'cooldown'
  | 'velocity'
  | 'pacing'
  | 'loop_lock'
  | 'other';

export interface LostOpportunityEventInput {
  eventId: string;
  suppressedMediaId: string;
  winningMediaId: string | null;
  reason: LostOpportunityReason;
  zoneId: string;
  ts: string;
}

/**
 * Publishes spatial ledger batches over MQTT (`openad/{deviceId}/spatial`) per `spatial-ledger.contract.ts` (005 US4/US5).
 */
@Injectable({ providedIn: 'root' })
export class SpatialTelemetryService {
  private readonly mqtt = inject(MqttClientService);
  private readonly session = inject(DeviceSessionService);

  async publishBatch(batch: SpatialLedgerBatch): Promise<void> {
    await this.mqtt.publishSpatialLedgerBatch(batch);
  }

  /** Emits `spatial.lost_opportunity` when arbitration or policy suppresses a candidate (005 US5). */
  async publishLostOpportunityEvents(
    events: LostOpportunityEventInput[]
  ): Promise<void> {
    if (events.length === 0) {
      return;
    }
    const deviceId = await this.session.getStoredDeviceId();
    if (!deviceId) {
      return;
    }
    const batch: SpatialLedgerBatch = {
      schemaVersion: 1,
      kind: 'spatial.lost_opportunity',
      ts: new Date().toISOString(),
      deviceId,
      events: events.map((e) => ({
        eventId: e.eventId,
        deviceId,
        suppressedMediaId: e.suppressedMediaId,
        winningMediaId: e.winningMediaId,
        reason: e.reason,
        zoneId: e.zoneId,
        ts: e.ts,
      })),
    };
    await this.publishBatch(batch);
  }
}
