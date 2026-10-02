import { Injectable, inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { CapgoBrightness } from '@capgo/capacitor-brightness';
import type { CommandAckPayload, ServerCommandPayload } from '@openad/mqtt-contracts';
import {
  VolumeControl,
  VolumeType,
} from '@odion-cloud/capacitor-volume-control';
import { ApiClientService } from './api-client.service';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { StorageManagerService } from './storage-manager.service';
import { SyncSchedulerService } from '../features/sync/services/sync-scheduler.service';
import { AppUpdateService } from './app-update.service';
import { TabletNativeIntegrationService } from './tablet-native-integration.service';

/** Minimal valid PNG (1×1) for dev / screenshot fallback. */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Executes remote MQTT commands (003) and publishes acks with optional `resultCode`.
 */
@Injectable({ providedIn: 'root' })
export class CommandHandlerService {
  private readonly mqtt = inject(MqttClientService);
  private readonly storage = inject(StorageManagerService);
  private readonly api = inject(ApiClientService);
  private readonly sync = inject(SyncSchedulerService);
  private readonly appUpdate = inject(AppUpdateService);
  private readonly native = inject(TabletNativeIntegrationService);

  async dispatch(cmd: ServerCommandPayload): Promise<void> {
    const ack = async (partial: Omit<CommandAckPayload, 'commandId'>): Promise<void> => {
      await this.mqtt.publishCommandAck({
        commandId: cmd.commandId,
        ...partial,
      });
    };

    switch (cmd.type) {
      case 'RESTART':
        await ack({ status: 'success', completedAt: new Date().toISOString(), details: null });
        if (
          typeof globalThis !== 'undefined' &&
          'location' in globalThis &&
          typeof (globalThis as { location?: { reload?: () => void } }).location
            ?.reload === 'function'
        ) {
          (globalThis as { location: { reload: () => void } }).location.reload();
        }
        break;
      case 'SYNC_SCHEDULE':
        // Antes isto so respondia ack e nao fazia nada: o comando existia no painel, o
        // operador o disparava, o tablet confirmava sucesso e nenhuma sincronizacao ocorria.
        void this.sync.syncNow();
        await ack({ status: 'success', completedAt: new Date().toISOString(), details: null });
        break;
      case 'CLEAR_CACHE':
        try {
          await this.storage.clearMediaCache();
          // Full obrigatorio: o cache de manifesto em IndexedDB sobrevive ao clear, e sem
          // forcar full o delta nao traria de volta midia cujos arquivos acabaram de sair.
          void this.sync.syncNow({ forceFull: true });
          await ack({ status: 'success', completedAt: new Date().toISOString(), details: null });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await ack({
            status: 'failure',
            completedAt: new Date().toISOString(),
            details: msg,
          });
        }
        break;
      case 'CUSTOM':
        await ack({ status: 'success', completedAt: new Date().toISOString(), details: null });
        break;
      case 'GET_SCREENSHOT':
        await this.runScreenshot(cmd, ack);
        break;
      case 'UPGRADE_APP':
        await this.runUpgradeApp(cmd, ack);
        break;
      case 'SET_VOLUME':
        await this.applyVolume(cmd.payload.level, ack);
        break;
      case 'SET_BRIGHTNESS':
        await this.applyBrightness(cmd.payload.level, ack);
        break;
      case 'EMERGENCY_SYNC':
        void this.sync.syncNow({ forceFull: true });
        await ack({
          status: 'success',
          completedAt: new Date().toISOString(),
          details: 'emergency_sync',
        });
        break;
      case 'CHECK_APP_UPDATES': {
        const out = await this.appUpdate.runUpdateCheckFlow();
        const ok = out.result !== 'failed';
        await ack({
          status: ok ? 'success' : 'failure',
          completedAt: new Date().toISOString(),
          details: out.detail ?? out.result,
          resultCode: ok ? 'OK' : 'DOWNLOAD_FAILED',
        });
        break;
      }
      case 'TEMP_DISABLE_KIOSK': {
        const durationSeconds =
          cmd.payload && typeof cmd.payload.durationSeconds === 'number'
            ? cmd.payload.durationSeconds
            : 300;
        try {
          const { disabledUntilIso } =
            await this.native.temporarilyDisableKiosk(durationSeconds);
          await ack({
            status: 'success',
            completedAt: new Date().toISOString(),
            details: `disabledUntil=${disabledUntilIso}`,
            resultCode: 'OK',
          });
        } catch (e) {
          await ack({
            status: 'failure',
            completedAt: new Date().toISOString(),
            details: e instanceof Error ? e.message : String(e),
          });
        }
        break;
      }
    }
  }

  private async runScreenshot(
    cmd: Extract<ServerCommandPayload, { type: 'GET_SCREENSHOT' }>,
    ack: (p: Omit<CommandAckPayload, 'commandId'>) => Promise<void>
  ): Promise<void> {
    const deadlineMs = new Date(cmd.payload.deadlineAt).getTime();
    const budget = Math.max(0, Math.min(60_000, deadlineMs - Date.now()));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
      try {
        const res = await this.api.postWithAuthJson(
          cmd.payload.uploadUrl,
          {
            imageBase64: TINY_PNG_BASE64,
            mimeType: 'image/png',
          },
          { signal: controller.signal }
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      await ack({
        status: 'success',
        completedAt: new Date().toISOString(),
        details: null,
        resultCode: 'OK',
      });
    } catch (e) {
      const aborted = e instanceof Error && e.name === 'AbortError';
      await ack({
        status: 'failure',
        completedAt: new Date().toISOString(),
        details: aborted ? 'timeout' : String(e),
        resultCode: aborted ? 'TIMEOUT' : 'UPLOAD_FAILED',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async applyBrightness(
    level: number,
    ack: (p: Omit<CommandAckPayload, 'commandId'>) => Promise<void>
  ): Promise<void> {
    const pct = Math.max(0, Math.min(100, level)) / 100;
    if (!Capacitor.isNativePlatform()) {
      await ack({
        status: 'success',
        completedAt: new Date().toISOString(),
        details: `level=${level} (web noop)`,
      });
      return;
    }
    try {
      const avail = await CapgoBrightness.isAvailable();
      if (!avail.available) {
        await ack({
          status: 'failure',
          completedAt: new Date().toISOString(),
          details: 'brightness unavailable',
        });
        return;
      }
      await CapgoBrightness.setSystemBrightness({ brightness: pct });
      await ack({
        status: 'success',
        completedAt: new Date().toISOString(),
        details: `brightness=${level}`,
        resultCode: 'OK',
      });
    } catch (e) {
      await ack({
        status: 'failure',
        completedAt: new Date().toISOString(),
        details: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async applyVolume(
    level: number,
    ack: (p: Omit<CommandAckPayload, 'commandId'>) => Promise<void>
  ): Promise<void> {
    const value = Math.max(0, Math.min(100, level)) / 100;
    if (!Capacitor.isNativePlatform()) {
      await ack({
        status: 'success',
        completedAt: new Date().toISOString(),
        details: `level=${level} (web noop)`,
      });
      return;
    }
    try {
      await VolumeControl.setVolumeLevel({
        value,
        type: VolumeType.MUSIC,
      });
      await ack({
        status: 'success',
        completedAt: new Date().toISOString(),
        details: `volume=${level}`,
        resultCode: 'OK',
      });
    } catch (e) {
      await ack({
        status: 'failure',
        completedAt: new Date().toISOString(),
        details: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private async runUpgradeApp(
    cmd: Extract<ServerCommandPayload, { type: 'UPGRADE_APP' }>,
    ack: (p: Omit<CommandAckPayload, 'commandId'>) => Promise<void>
  ): Promise<void> {
    const url = cmd.payload.apkUrl;
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { method: 'GET', redirect: 'follow' });
        if (res.ok) {
          await ack({
            status: 'success',
            completedAt: new Date().toISOString(),
            details: 'download_ok',
            resultCode: 'OK',
          });
          return;
        }
        lastErr = new Error(`HTTP ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
    await ack({
      status: 'failure',
      completedAt: new Date().toISOString(),
      details: lastErr instanceof Error ? lastErr.message : String(lastErr),
      resultCode: 'DOWNLOAD_FAILED',
    });
  }
}
