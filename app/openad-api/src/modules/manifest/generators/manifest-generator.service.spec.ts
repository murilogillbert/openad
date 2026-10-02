import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import { ManifestGeneratorService } from './manifest-generator.service';
import { SpatialManifestBuilderService } from './spatial-manifest-builder.service';
import {
  CampaignEligibilityService,
  type EligibleCampaign,
} from './campaign-eligibility.service';
import { AssetStorageService } from '../../../infrastructure/storage/asset-storage.service';
import { MediaAsset } from '../../media-ingestion/schemas/media-asset.schema';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';

const DEVICE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const spatialManifestStub = {
  build: jest.fn().mockResolvedValue({
    version: '2026-01-01T00:00:00.000Z',
    entries: [],
  }),
};

const metricsStub = {
  spatialManifestBuildSeconds: { observe: jest.fn() },
} as unknown as MetricsService;

interface MediaRow {
  mediaId: string;
  campaignId?: string;
  storageUrl: string;
}

const mediaRow = (over: MediaRow): Record<string, unknown> => ({
  hash: 'a'.repeat(64),
  filename: 'x.mp4',
  fileSize: 100,
  bitrate: 1000,
  width: 320,
  height: 240,
  codec: 'h264' as const,
  duration: 60,
  categorization: 'universal' as const,
  isActive: true,
  ...over,
});

async function buildService(
  rows: Record<string, unknown>[],
  eligible: Map<string, EligibleCampaign>
) {
  const model = {
    find: jest.fn().mockReturnValue({
      sort: () => ({ lean: () => ({ exec: async () => rows }) }),
    }),
  };
  const s3 = {
    getPresignedGetUrl: jest
      .fn()
      .mockImplementation(async (key: string) => `https://signed.example/${key}`),
  };
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger;

  const mod = await Test.createTestingModule({
    providers: [
      ManifestGeneratorService,
      { provide: getModelToken(MediaAsset.name), useValue: model },
      { provide: AssetStorageService, useValue: s3 },
      { provide: SpatialManifestBuilderService, useValue: spatialManifestStub },
      {
        provide: CampaignEligibilityService,
        useValue: { resolveEligible: jest.fn().mockResolvedValue(eligible) },
      },
      { provide: MetricsService, useValue: metricsStub },
      { provide: PinoLogger, useValue: logger },
    ],
  }).compile();

  return { svc: mod.get(ManifestGeneratorService), s3 };
}

const eligibleWith = (
  ...entries: Array<[string, number]>
): Map<string, EligibleCampaign> =>
  new Map(
    entries.map(([campaignId, campaignPriority]) => [
      campaignId,
      { campaignId, campaignPriority },
    ])
  );

describe('ManifestGeneratorService', () => {
  it('mapeia midia ativa para itens com URL presignada', async () => {
    const { svc, s3 } = await buildService(
      [mediaRow({ mediaId: 'm-1', storageUrl: 'memory:k1' })],
      eligibleWith()
    );

    const r = await svc.build(DEVICE_ID, {});

    expect(r.media).toHaveLength(1);
    expect(r.spatial.entries).toEqual([]);
    expect(r.media[0]?.downloadUrl).toContain('https://');
    expect(s3.getPresignedGetUrl).toHaveBeenCalledWith('memory:k1', 3600);
  });

  it('inclui campaignId quando a campanha esta apta', async () => {
    const campaignId = 'c0ffee00-0000-4000-8000-00000000beef';
    const { svc } = await buildService(
      [mediaRow({ mediaId: 'm-2', storageUrl: 'memory:k2', campaignId })],
      eligibleWith([campaignId, 1])
    );

    const r = await svc.build(DEVICE_ID, {});

    expect(r.media[0]?.campaignId).toBe(campaignId);
  });

  /**
   * O defeito central: o gerador devolvia toda a midia com `isActive: true` da plataforma,
   * sem olhar status, janela ou orcamento da campanha. Campanha em draft, encerrada,
   * vencida ou com pacing `paused` continuava sendo distribuida e tocada.
   */
  it('exclui midia de campanha que nao esta apta', async () => {
    const apta = 'aaaaaaaa-0000-4000-8000-000000000001';
    const inapta = 'bbbbbbbb-0000-4000-8000-000000000002';
    const { svc } = await buildService(
      [
        mediaRow({ mediaId: 'm-apta', storageUrl: 'memory:ok', campaignId: apta }),
        mediaRow({
          mediaId: 'm-inapta',
          storageUrl: 'memory:no',
          campaignId: inapta,
        }),
      ],
      eligibleWith([apta, 1])
    );

    const r = await svc.build(DEVICE_ID, {});

    expect(r.media.map((m) => m.mediaId)).toEqual(['m-apta']);
  });

  it('nao gera URL presignada para midia excluida', async () => {
    const inapta = 'bbbbbbbb-0000-4000-8000-000000000002';
    const { svc, s3 } = await buildService(
      [
        mediaRow({
          mediaId: 'm-inapta',
          storageUrl: 'memory:no',
          campaignId: inapta,
        }),
      ],
      eligibleWith()
    );

    const r = await svc.build(DEVICE_ID, {});

    expect(r.media).toHaveLength(0);
    expect(s3.getPresignedGetUrl).not.toHaveBeenCalled();
  });

  it('mantem midia sem campanha (institucional) com prioridade de filler', async () => {
    const { svc } = await buildService(
      [mediaRow({ mediaId: 'm-filler', storageUrl: 'memory:f' })],
      eligibleWith()
    );

    const r = await svc.build(DEVICE_ID, {});

    expect(r.media).toHaveLength(1);
    expect(r.media[0]?.campaignId).toBeUndefined();
    expect(r.media[0]?.priority).toBe(100);
  });

  /**
   * Antes a prioridade vinha da posicao na lista ordenada por `createdAt` (`1000 - i * 10`),
   * ou seja, midia mais recente ganhava prioridade maior independente da campanha. Isso
   * decide o que sobrevive quando o armazenamento do tablet aperta.
   */
  it('deriva a prioridade da campanha e ordena da maior para a menor', async () => {
    const alta = 'aaaaaaaa-0000-4000-8000-000000000001';
    const baixa = 'bbbbbbbb-0000-4000-8000-000000000002';
    const { svc } = await buildService(
      [
        // Ordem de entrada ao contrario da prioridade, de proposito.
        mediaRow({ mediaId: 'm-baixa', storageUrl: 'memory:b', campaignId: baixa }),
        mediaRow({ mediaId: 'm-filler', storageUrl: 'memory:f' }),
        mediaRow({ mediaId: 'm-alta', storageUrl: 'memory:a', campaignId: alta }),
      ],
      eligibleWith([alta, 1], [baixa, 5])
    );

    const r = await svc.build(DEVICE_ID, {});

    expect(r.media.map((m) => m.mediaId)).toEqual([
      'm-alta',
      'm-baixa',
      'm-filler',
    ]);
    expect(r.media[0]?.priority).toBeGreaterThan(r.media[1]!.priority);
    expect(r.media[1]?.priority).toBeGreaterThan(r.media[2]!.priority);
  });
});
