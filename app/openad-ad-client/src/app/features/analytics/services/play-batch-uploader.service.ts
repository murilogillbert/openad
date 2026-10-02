import { isPlatformBrowser } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { from, interval } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import type { PlayRecordPayload } from '@openad/api-contracts';
import { v4 as uuidv4 } from 'uuid';
import { ApiClientService } from '../../../services/api-client.service';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PlayRecordBufferService } from './play-record-buffer.service';

const BATCH_SIZE = 80;
const FLUSH_MS = 45_000;

interface BatchIngestResponse {
  batchId: string;
  acceptedCount: number;
  enqueued: boolean;
  rejected?: Array<{ index: number; uniqueEventId: string | null; message: string }>;
}

/**
 * Flushes buffered plays in batches (FR-003, FR-004) with connectivity deferral.
 */
@Injectable()
export class PlayBatchUploaderService {
  private readonly api = inject(ApiClientService);
  private readonly buffer = inject(PlayRecordBufferService);
  private readonly session = inject(DeviceSessionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    interval(FLUSH_MS)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => from(this.tryFlush()))
      )
      .subscribe();

    if (Capacitor.isPluginAvailable('Network')) {
      void Network.addListener('networkStatusChange', () => {
        void this.tryFlush();
      });
    }
  }

  /** Manual flush (e.g. app resume). */
  async tryFlush(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const deviceId = await this.session.getStoredDeviceId();
    if (!deviceId) {
      return;
    }
    const connected = await this.isOnlineEnough();
    if (!connected) {
      return;
    }
    const pending = await this.buffer.peekPendingNotUploaded(BATCH_SIZE);
    if (pending.length === 0) {
      return;
    }
    const batchId = uuidv4();
    const plays: PlayRecordPayload[] = pending.map((p) => {
      const { uploaded: _u, createdAt: _c, ...rest } = p;
      return rest;
    });
    const body = {
      schemaVersion: 1 as const,
      batchId,
      deviceId,
      plays,
    };
    let attempt = 0;
    const maxAttempts = 4;
    while (attempt < maxAttempts) {
      try {
        const res = await this.api.postWithAuth<BatchIngestResponse>(
          `/api/v1/devices/${encodeURIComponent(deviceId)}/analytics/play-batches`,
          body
        );
        const rejectedIdx = new Set((res.rejected ?? []).map((r) => r.index));
        const acceptedIds = plays
          .map((p, i) => ({ p, i }))
          .filter(({ i }) => !rejectedIdx.has(i))
          .map(({ p }) => p.uniqueEventId);
        if (acceptedIds.length > 0) {
          await this.buffer.markUploaded(acceptedIds);
        }
        return;
      } catch {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  private async isOnlineEnough(): Promise<boolean> {
    if (!Capacitor.isPluginAvailable('Network')) {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    }
    try {
      const s = await Network.getStatus();
      return s.connected;
    } catch {
      return true;
    }
  }
}
