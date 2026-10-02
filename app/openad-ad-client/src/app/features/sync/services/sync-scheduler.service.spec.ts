import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PairingEventsService } from '../../../services/pairing-events.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';
import { SyncSchedulerService } from './sync-scheduler.service';

describe('SyncSchedulerService', () => {
  let syncNow: ReturnType<typeof vi.fn>;
  let getStoredDeviceId: ReturnType<typeof vi.fn>;
  let pairingComplete$: Subject<{ deviceId: string }>;

  const build = (): SyncSchedulerService => TestBed.inject(SyncSchedulerService);

  beforeEach(() => {
    syncNow = vi.fn().mockResolvedValue(undefined);
    getStoredDeviceId = vi.fn().mockResolvedValue('device-1');
    pairingComplete$ = new Subject();

    TestBed.configureTestingModule({
      providers: [
        SyncSchedulerService,
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: SyncOrchestratorService, useValue: { syncNow } },
        { provide: DeviceSessionService, useValue: { getStoredDeviceId } },
        { provide: PairingEventsService, useValue: { pairingComplete$ } },
      ],
    });
  });

  it('sincroniza quando o device esta pareado', async () => {
    await build().syncNow();
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  it('nao sincroniza sem pareamento — a primeira vem do evento de bind', async () => {
    getStoredDeviceId.mockResolvedValue(null);
    await build().syncNow();
    expect(syncNow).not.toHaveBeenCalled();
  });

  /**
   * O orquestrador grava arquivos e `Preferences`. Intervalo, comando MQTT e volta de rede
   * podem coincidir, e duas execucoes simultaneas corromperiam o estado local.
   */
  it('serializa chamadas concorrentes numa unica execucao', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    syncNow.mockImplementation(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent -= 1;
    });

    const svc = build();
    await Promise.all([svc.syncNow(), svc.syncNow(), svc.syncNow()]);

    expect(syncNow).toHaveBeenCalledTimes(1);
    expect(maxConcurrent).toBe(1);
  });

  it('repassa forceFull para o orquestrador', async () => {
    await build().syncNow({ forceFull: true });
    expect(syncNow).toHaveBeenCalledWith({ forceFull: true });
  });

  it('nao propaga falha, e registra para a volta de rede poder reagir', async () => {
    syncNow.mockRejectedValue(new Error('manifest_failed'));
    const svc = build();

    await expect(svc.syncNow()).resolves.toBeUndefined();
    expect(svc.lastSyncFailed).toBe(true);
  });

  it('libera o in-flight depois de falhar, permitindo nova tentativa', async () => {
    syncNow.mockRejectedValueOnce(new Error('manifest_failed'));
    const svc = build();

    await svc.syncNow();
    await svc.syncNow();

    expect(syncNow).toHaveBeenCalledTimes(2);
  });
});
