import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ServerCommandPayload } from '@openad/mqtt-contracts';
import { CommandHandlerService } from './command-handler.service';
import { ApiClientService } from './api-client.service';
import { MqttClientService } from '../features/mqtt/services/mqtt-client.service';
import { StorageManagerService } from './storage-manager.service';
import { ManifestSyncService } from './sync/manifest-sync.service';

describe('CommandHandlerService', () => {
  let publishAck: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    publishAck = vi.fn().mockResolvedValue(undefined);
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
          provide: ManifestSyncService,
          useValue: {
            onCacheCleared: vi.fn(),
            runManifestSync: vi.fn().mockResolvedValue(undefined),
            requestEmergencySync: vi.fn(),
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
});
