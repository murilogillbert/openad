import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import {
  CampaignEligibilityService,
  manifestPriorityFor,
} from './campaign-eligibility.service';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import { PacingSignalService } from '../../analytics/services/pacing-signal.service';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';
import { platformConfigDefaults } from '../../platform-config/platform-config.service';

const NOW = new Date('2026-06-15T12:00:00.000Z');

type PacingState = 'normal' | 'near_cap' | 'paused';

async function buildService(params: {
  campaigns: Array<{
    campaignId: string;
    priority: number;
    targeting?: unknown;
    driverPayout?: unknown;
    budget?: { ratePerImpressionCents: number };
  }>;
  pacing?: Record<string, PacingState>;
  /** `k` do leilao de repasse. `0` (padrao) desliga e faz `payoutBoost` valer 1. */
  auctionWeight?: number;
}) {
  const findMany = jest.fn().mockResolvedValue(params.campaigns);
  const getSnapshot = jest.fn().mockImplementation(async (campaignId: string) => {
    const state = params.pacing?.[campaignId];
    return state ? { campaignId, pacingState: state } : null;
  });
  const logger = {
    setContext: jest.fn(),
    debug: jest.fn(),
  } as unknown as PinoLogger;

  const base = platformConfigDefaults();
  const platform = {
    get: () => ({
      ...base,
      monetization: {
        ...base.monetization,
        driverPayoutAuctionWeight: params.auctionWeight ?? 0,
      },
    }),
  } as unknown as PlatformConfigRuntimeService;

  const mod = await Test.createTestingModule({
    providers: [
      CampaignEligibilityService,
      { provide: CampaignsRepository, useValue: { findMany } },
      { provide: PacingSignalService, useValue: { getSnapshot } },
      { provide: PlatformConfigRuntimeService, useValue: platform },
      { provide: PinoLogger, useValue: logger },
    ],
  }).compile();

  return { svc: mod.get(CampaignEligibilityService), findMany, getSnapshot };
}

describe('CampaignEligibilityService', () => {
  /**
   * O filtro de status e janela tem de estar na consulta, nao em memoria: a plataforma
   * inteira passa por aqui a cada manifesto pedido por qualquer tablet.
   */
  it('consulta apenas campanhas active dentro da janela contratada', async () => {
    const { svc, findMany } = await buildService({ campaigns: [] });

    await svc.resolveEligible(NOW);

    expect(findMany).toHaveBeenCalledWith({
      status: 'active',
      scheduledStart: { $lte: NOW },
      scheduledEnd: { $gte: NOW },
    });
  });

  it('inclui campanha sem registro de pacing no dia', async () => {
    const { svc } = await buildService({
      campaigns: [{ campaignId: 'c-1', priority: 3 }],
    });

    const eligible = await svc.resolveEligible(NOW);

    expect(eligible.get('c-1')).toEqual({
      campaignId: 'c-1',
      campaignPriority: 3,
      // Campanha sem `targeting` alcanca tudo, e sem leilao o multiplicador e neutro.
      targeting: null,
      payoutBoost: 1,
    });
  });

  it('inclui campanha em near_cap — desacelera, nao para', async () => {
    const { svc } = await buildService({
      campaigns: [{ campaignId: 'c-1', priority: 1 }],
      pacing: { 'c-1': 'near_cap' },
    });

    const eligible = await svc.resolveEligible(NOW);

    expect(eligible.has('c-1')).toBe(true);
  });

  /** Orcamento diario esgotado tem de parar a distribuicao, nao so reduzi-la. */
  it('exclui campanha com pacing paused', async () => {
    const { svc } = await buildService({
      campaigns: [
        { campaignId: 'c-ok', priority: 1 },
        { campaignId: 'c-estourada', priority: 1 },
      ],
      pacing: { 'c-estourada': 'paused' },
    });

    const eligible = await svc.resolveEligible(NOW);

    expect([...eligible.keys()]).toEqual(['c-ok']);
  });

  describe('leilao de repasse', () => {
    /** O piso padrao de `platform_config` e 0,3. */
    const PISO = platformConfigDefaults().monetization.driverPayoutMinPercent;

    it('com k = 0 o leilao esta desligado e o multiplicador e neutro', async () => {
      // É a saída de emergência: se o comportamento em produção surpreender, zerar `k` no
      // painel devolve a entrega ao critério puramente geográfico, sem redeploy.
      const { svc } = await buildService({
        auctionWeight: 0,
        campaigns: [
          {
            campaignId: 'c-generosa',
            priority: 1,
            driverPayout: { model: 'percent', percent: 0.9, valueCents: null },
            budget: { ratePerImpressionCents: 100 },
          },
        ],
      });
      const e = await svc.resolveEligible(NOW);
      expect(e.get('c-generosa')?.payoutBoost).toBe(1);
    });

    it('campanha no piso exato nao ganha nem perde inventario', async () => {
      const { svc } = await buildService({
        auctionWeight: 0.5,
        campaigns: [
          {
            campaignId: 'c-piso',
            priority: 1,
            driverPayout: { model: 'percent', percent: PISO, valueCents: null },
            budget: { ratePerImpressionCents: 100 },
          },
        ],
      });
      const e = await svc.resolveEligible(NOW);
      expect(e.get('c-piso')?.payoutBoost).toBeCloseTo(1, 10);
    });

    it('quem oferece acima do piso ganha inventario', async () => {
      // Sem isto o piso viraria custo fixo e ninguém teria motivo para superá-lo.
      const { svc } = await buildService({
        auctionWeight: 0.5,
        campaigns: [
          {
            campaignId: 'c-dobro',
            priority: 1,
            driverPayout: { model: 'percent', percent: PISO * 2, valueCents: null },
            budget: { ratePerImpressionCents: 100 },
          },
        ],
      });
      const e = await svc.resolveEligible(NOW);
      // 1 + 0,5 * (2 - 1) = 1,5
      expect(e.get('c-dobro')?.payoutBoost).toBeCloseTo(1.5, 10);
    });

    it('normaliza repasse fixo contra a tarifa, para comparar com percentual', async () => {
      // `per_play` e `percent` não são comparáveis sem normalizar; 60 centavos sobre uma
      // tarifa de 100 é 60%, o dobro do piso de 30%.
      const { svc } = await buildService({
        auctionWeight: 0.5,
        campaigns: [
          {
            campaignId: 'c-fixo',
            priority: 1,
            driverPayout: { model: 'per_play', percent: null, valueCents: 60 },
            budget: { ratePerImpressionCents: 100 },
          },
        ],
      });
      const e = await svc.resolveEligible(NOW);
      expect(e.get('c-fixo')?.payoutBoost).toBeCloseTo(1.5, 10);
    });

    it('o multiplicador tem teto, para dinheiro nao atropelar relevancia geografica', async () => {
      const { svc } = await buildService({
        auctionWeight: 5,
        campaigns: [
          {
            campaignId: 'c-exagerada',
            priority: 1,
            driverPayout: { model: 'percent', percent: 0.99, valueCents: null },
            budget: { ratePerImpressionCents: 100 },
          },
        ],
      });
      const e = await svc.resolveEligible(NOW);
      expect(e.get('c-exagerada')?.payoutBoost).toBe(3);
    });
  });

  it('propaga a segmentacao gravada na campanha', async () => {
    const { svc } = await buildService({
      campaigns: [
        {
          campaignId: 'c-seg',
          priority: 1,
          targeting: { cities: ['Cuiabá'], zoneIds: [], tiers: [], vehicleTiers: [], dayparts: [] },
        },
      ],
    });
    const e = await svc.resolveEligible(NOW);
    expect(e.get('c-seg')?.targeting?.cities).toEqual(['Cuiabá']);
  });
});

describe('manifestPriorityFor', () => {
  /**
   * `campaigns.priority` e 1 = mais alta; a prioridade do manifesto e maior = mais
   * importante, porque e ela que o player usa para decidir o que descartar quando o
   * armazenamento aperta. A conversao inverte a escala.
   */
  it('inverte a escala: prioridade 1 da campanha vira a maior do manifesto', () => {
    expect(manifestPriorityFor(1)).toBeGreaterThan(manifestPriorityFor(2));
    expect(manifestPriorityFor(2)).toBeGreaterThan(manifestPriorityFor(10));
  });

  it('mantem campanha sempre acima do filler', () => {
    expect(manifestPriorityFor(90)).toBeGreaterThan(100);
  });

  it('tolera valores fora da faixa sem inverter a ordem', () => {
    expect(manifestPriorityFor(0)).toBe(manifestPriorityFor(1));
    expect(manifestPriorityFor(1000)).toBe(manifestPriorityFor(90));
  });
});
