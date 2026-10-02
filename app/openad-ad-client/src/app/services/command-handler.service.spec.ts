import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerCommandPayload } from '@openad/mqtt-contracts';
import { CommandHandlerService } from './command-handler.service';
import { ApiClientService } from './api-client.service';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { StorageManagerService } from './storage-manager.service';
import { SyncSchedulerService } from '../features/sync/services/sync-scheduler.service';

describe('CommandHandlerService', () => {
  let publishAck: ReturnType<typeof vi.fn>;
  let syncNow: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    publishAck = vi.fn().mockResolvedValue(undefined);
    syncNow = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        CommandHandlerService,
        {
          provide: MqttClientService,
          useValue: {
            publishCommandAck: publishAck,
          },
        },
        {
          provide: StorageManagerService,
          useValue: {
            clearMediaCache: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ApiClientService,
          useValue: {
            postWithAuthJson: vi.fn().mockResolvedValue({
              ok: true,
              status: 204,
            }),
          },
        },
        {
          provide: SyncSchedulerService,
          useValue: {
            syncNow: syncNow,
          },
        },
      ],
    });
  });

  it('acks RESTART', async () => {
    const svc = TestBed.inject(CommandHandlerService);
    const cmd: ServerCommandPayload = {
      commandId: 'c1',
      type: 'RESTART',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    };
    await svc.dispatch(cmd);
    expect(publishAck).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'c1', status: 'success' })
    );
  });

  it('acks CLEAR_CACHE via storage', async () => {
    const svc = TestBed.inject(CommandHandlerService);
    const cmd: ServerCommandPayload = {
      commandId: 'c2',
      type: 'CLEAR_CACHE',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    };
    await svc.dispatch(cmd);
    expect(publishAck).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'c2', status: 'success' })
    );
  });

  it('CLEAR_CACHE forca sincronizacao completa', async () => {
    const svc = TestBed.inject(CommandHandlerService);
    await svc.dispatch({
      commandId: 'c2',
      type: 'CLEAR_CACHE',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    });
    expect(syncNow).toHaveBeenCalledWith({ forceFull: true });
  });

  /**
   * Regressao: SYNC_SCHEDULE respondia ack de sucesso sem sincronizar nada. O operador
   * disparava o comando pelo painel, recebia confirmacao e o tablet nao fazia nada.
   */
  it('SYNC_SCHEDULE dispara sincronizacao, nao so o ack', async () => {
    const svc = TestBed.inject(CommandHandlerService);
    await svc.dispatch({
      commandId: 'c3',
      type: 'SYNC_SCHEDULE',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    });
    expect(syncNow).toHaveBeenCalled();
    expect(publishAck).toHaveBeenCalledWith(
      expect.objectContaining({ commandId: 'c3', status: 'success' })
    );
  });

  it('EMERGENCY_SYNC forca sincronizacao completa', async () => {
    const svc = TestBed.inject(CommandHandlerService);
    await svc.dispatch({
      commandId: 'c4',
      type: 'EMERGENCY_SYNC',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      payload: null,
    });
    expect(syncNow).toHaveBeenCalledWith({ forceFull: true });
  });
});
