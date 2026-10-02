import { Injectable, inject } from '@angular/core';
import type { SpatialEntryContract } from '@openad/api-contracts';
import { PlaybackEngineService } from '../../playback/services/playback-engine.service';
import { SpatialTelemetryService } from './spatial-telemetry.service';
import { evaluateVelocityGate } from './velocity-gate.util';

@Injectable({ providedIn: 'root' })
export class SpatialPlaybackBridgeService {
  private readonly playback = inject(PlaybackEngineService);
  private readonly telemetry = inject(SpatialTelemetryService);

  async notifyEligibleMedia(
    entry: SpatialEntryContract,
    speedKmh?: number
  ): Promise<void> {
    const gate = evaluateVelocityGate(speedKmh, entry);
    if (!gate.allowed) {
      await this.telemetry.publishLostOpportunityEvents([
        {
          eventId: crypto.randomUUID(),
          suppressedMediaId: entry.mediaId,
          winningMediaId: null,
          reason: 'velocity',
          zoneId: entry.zoneId,
          ts: new Date().toISOString(),
        },
      ]);
      return;
    }
    await this.playback.requestSpatialPlayback(entry.mediaId);
  }
}
