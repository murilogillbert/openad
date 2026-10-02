import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';
import {
  CampaignEligibilityService,
  manifestPriorityFor,
} from './campaign-eligibility.service';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import { PacingSignalService } from '../../analytics/services/pacing-signal.service';

const NOW = new Date('2026-06-15T12:00:00.000Z');

type PacingState = 'normal' | 'near_cap' | 'paused';

async function buildService(params: {
  campaigns: Array<{ campaignId: string; priority: number }>;
  pacing?: Record<string, PacingState>;
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

  const mod = await Test.createTestingModule({
    providers: [
      CampaignEligibilityService,
      { provide: CampaignsRepository, useValue: { findMany } },
      { provide: PacingSignalService, useValue: { getSnapshot } },
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
