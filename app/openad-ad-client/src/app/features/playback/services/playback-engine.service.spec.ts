import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EMPTY } from 'rxjs';
import {
  PlaybackEngineService,
  duracaoDeExibicaoMs,
  kindOf,
  prazoMaximoDeVideoMs,
} from './playback-engine.service';
import type { ManifestMediaItem } from '../../sync/models/manifest-api.model';
import { ConstraintFilterService } from './constraint-filter.service';
import { LoopManagerService } from './loop-manager.service';
import { PriorityQueueService } from './priority-queue.service';
import { DownloadProgressIdbService } from '../../sync/services/download-progress-idb.service';
import { ManifestSyncEventsService } from '../../sync/services/manifest-sync-events.service';
import { MqttClientService } from '../../mqtt/services/mqtt-client.service';
import { DeviceInfoService } from '../../../core/services/device-info.service';
import { DeviceFleetContextService } from '../../../services/device-fleet-context.service';
import { DeviceSessionService } from '../../../services/device-session.service';
import { PlayRecordBufferService } from '../../analytics/services/play-record-buffer.service';

describe('PlaybackEngineService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        PlaybackEngineService,
        ConstraintFilterService,
        LoopManagerService,
        PriorityQueueService,
        {
          provide: DownloadProgressIdbService,
          useValue: {
            getCachedManifest: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: ManifestSyncEventsService,
          useValue: { manifestSynced$: EMPTY },
        },
        {
          provide: MqttClientService,
          useValue: {
            priorityCommand$: EMPTY,
            publishPriorityAck: vi.fn(),
          },
        },
        {
          provide: DeviceInfoService,
          useValue: {
            start: vi.fn().mockResolvedValue(undefined),
            location: vi.fn().mockReturnValue(null),
          },
        },
        {
          provide: DeviceSessionService,
          useValue: { getStoredDeviceId: vi.fn().mockResolvedValue(null) },
        },
        {
          provide: DeviceFleetContextService,
          useValue: {
            refreshBoundVehicle: vi.fn().mockResolvedValue(undefined),
            resolveBoundVehicleId: vi.fn().mockResolvedValue(null),
          },
        },
        {
          provide: PlayRecordBufferService,
          useValue: { enqueuePlay: vi.fn().mockResolvedValue(undefined) },
        },
      ],
    });
  });

  it('reloadFromManifest clears queue when no cached manifest', async () => {
    await new Promise((r) => setTimeout(r, 30));
    const engine = TestBed.inject(PlaybackEngineService);
    await engine.reloadFromManifest();
    expect(engine.currentAd()).toBeNull();
  });

  /**
   * Toda a frota de criativos e JPEG/PNG. Com `currentKind` fixo em video o tablete montava
   * um `<video>` para eles, o elemento nunca decodificava e a tela ficava preta.
   */
  it('marca item de imagem como image e agenda a troca por tempo', async () => {
    await new Promise((r) => setTimeout(r, 30));
    const idb = TestBed.inject(DownloadProgressIdbService);
    vi.mocked(idb.getCachedManifest).mockResolvedValue({
      deviceId: 'd',
      version: 'v1',
      media: [imagem({ mediaId: 'm-img', duration: 1 })],
    });

    const engine = TestBed.inject(PlaybackEngineService);
    await engine.reloadFromManifest();

    expect(engine.currentKind()).toBe('image');

    // `<img>` nao emite `ended`: sem o temporizador o laco pararia no primeiro criativo.
    const avancou = vi.spyOn(engine, 'advance').mockResolvedValue(undefined);
    await new Promise((r) => setTimeout(r, 1_300));
    expect(avancou).toHaveBeenCalled();
  });

  /**
   * Video avanca no `ended`, nao por tempo. O prazo existe so para o caso em que o `ended`
   * nunca chega, e por isso tem de ficar **muito** acima da duracao: cortar um video no
   * proprio tempo nominal truncaria o anuncio.
   */
  it('nao corta video na duracao nominal; o prazo de seguranca e bem maior', async () => {
    await new Promise((r) => setTimeout(r, 30));
    const idb = TestBed.inject(DownloadProgressIdbService);
    vi.mocked(idb.getCachedManifest).mockResolvedValue({
      deviceId: 'd',
      version: 'v1',
      media: [
        imagem({ mediaId: 'm-vid', duration: 1, mimeType: 'video/mp4' }),
      ],
    });

    const engine = TestBed.inject(PlaybackEngineService);
    await engine.reloadFromManifest();

    expect(engine.currentKind()).toBe('video');

    const avancou = vi.spyOn(engine, 'advance').mockResolvedValue(undefined);
    await new Promise((r) => setTimeout(r, 1_300));
    expect(avancou).not.toHaveBeenCalled();
  });
});

const imagem = (over: Partial<ManifestMediaItem>): ManifestMediaItem => ({
  mediaId: 'm',
  hash: 'h'.repeat(64),
  priority: 100,
  downloadUrl: 'https://exemplo/x',
  fileSize: 10,
  duration: 10,
  mimeType: 'image/jpeg',
  ...over,
});

describe('kindOf', () => {
  it('usa o mimeType do item do manifesto', () => {
    expect(kindOf({ kind: 'manifest', item: imagem({}) })).toBe('image');
    expect(
      kindOf({ kind: 'manifest', item: imagem({ mimeType: 'video/mp4' }) })
    ).toBe('video');
  });

  /** Manifesto gravado por servidor anterior ao campo: video era o unico comportamento. */
  it('trata mimeType ausente como video', () => {
    expect(
      kindOf({ kind: 'manifest', item: imagem({ mimeType: undefined }) })
    ).toBe('video');
  });

  it('deduz pela extensao no fallback de fabrica, que nao tem manifesto', () => {
    expect(
      kindOf({ kind: 'factory', url: '/factory/a.jpg', mediaId: 'f:a' })
    ).toBe('image');
    expect(
      kindOf({ kind: 'factory', url: '/factory/a.mp4', mediaId: 'f:a' })
    ).toBe('video');
    expect(
      kindOf({ kind: 'factory', url: '/factory/a.png?v=2', mediaId: 'f:a' })
    ).toBe('image');
  });
});

describe('duracaoDeExibicaoMs', () => {
  it('converte a duracao do manifesto para milissegundos', () => {
    expect(
      duracaoDeExibicaoMs({ kind: 'manifest', item: imagem({ duration: 8 }) })
    ).toBe(8_000);
  });

  it('cai para 10s quando a duracao nao e utilizavel', () => {
    expect(
      duracaoDeExibicaoMs({ kind: 'manifest', item: imagem({ duration: 0 }) })
    ).toBe(10_000);
    expect(
      duracaoDeExibicaoMs({ kind: 'factory', url: '/f/a.jpg', mediaId: 'f:a' })
    ).toBe(10_000);
  });

  /** Mesmo teto de `platform_config.mediaLimits.maxDurationSeconds`. */
  it('limita a 120s um criativo com duracao absurda', () => {
    expect(
      duracaoDeExibicaoMs({ kind: 'manifest', item: imagem({ duration: 9_999 }) })
    ).toBe(120_000);
  });
});

describe('prazoMaximoDeVideoMs', () => {
  it('da folga sobre a duracao real, para nao truncar o anuncio', () => {
    expect(
      prazoMaximoDeVideoMs({
        kind: 'manifest',
        item: imagem({ duration: 30, mimeType: 'video/mp4' }),
      })
    ).toBe(35_000);
  });

  it('usa o teto de 120s quando a duracao e desconhecida ou maior que o teto', () => {
    expect(
      prazoMaximoDeVideoMs({
        kind: 'manifest',
        item: imagem({ duration: 0, mimeType: 'video/mp4' }),
      })
    ).toBe(125_000);
    expect(
      prazoMaximoDeVideoMs({
        kind: 'manifest',
        item: imagem({ duration: 9_999, mimeType: 'video/mp4' }),
      })
    ).toBe(125_000);
  });
});
