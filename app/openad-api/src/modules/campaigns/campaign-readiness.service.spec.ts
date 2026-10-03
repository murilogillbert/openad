import { CampaignReadinessService } from './campaign-readiness.service';
import type { CreativeAssetsRepository } from './creative-assets.repository';
import type { ScheduleRulesRepository } from '../schedule-rules/schedule-rules.repository';

describe('CampaignReadinessService', () => {
  function montar(params: {
    regras?: Array<{ assetId: string }>;
    ativos?: Record<string, { status: string } | null>;
    midias?: number;
  }) {
    const rules = {
      findActiveByCampaignId: jest
        .fn()
        .mockResolvedValue(params.regras ?? []),
    } as unknown as ScheduleRulesRepository;
    const creativeAssets = {
      findByAssetId: jest.fn(async (id: string) => params.ativos?.[id] ?? null),
    } as unknown as CreativeAssetsRepository;
    const media = {
      countDocuments: jest.fn().mockReturnValue({
        exec: async () => params.midias ?? 0,
      }),
    };
    return new CampaignReadinessService(
      rules,
      creativeAssets,
      media as never
    );
  }

  it('pronta pela geracao 1: regra ativa com criativo verificado', async () => {
    const svc = montar({
      regras: [{ assetId: 'a1' }],
      ativos: { a1: { status: 'verified' } },
    });
    const r = await svc.verificar('c1');
    expect(r.pronta).toBe(true);
    expect(r.via).toBe('schedule_rules');
  });

  it('nao pronta quando a regra aponta para criativo nao verificado', async () => {
    const svc = montar({
      regras: [{ assetId: 'a1' }],
      ativos: { a1: { status: 'pending' } },
    });
    const r = await svc.verificar('c1');
    expect(r.pronta).toBe(false);
    expect(r.motivo).toContain('criativo verificado');
  });

  it('nao pronta quando a regra aponta para criativo inexistente', async () => {
    const svc = montar({ regras: [{ assetId: 'fantasma' }], ativos: {} });
    const r = await svc.verificar('c1');
    expect(r.pronta).toBe(false);
  });

  it('pronta pelo catalogo de midia quando nao ha regra de agendamento', async () => {
    // Este e o caso da campanha de anunciante, e era exatamente o que a verificacao
    // anterior recusava: ela exigia regra de agendamento, que esse caminho nao tem.
    const svc = montar({ regras: [], midias: 1 });
    const r = await svc.verificar('c1');
    expect(r.pronta).toBe(true);
    expect(r.via).toBe('media_assets');
  });

  it('nao pronta quando nao ha nem regra nem midia', async () => {
    const svc = montar({ regras: [], midias: 0 });
    const r = await svc.verificar('c1');
    expect(r.pronta).toBe(false);
    expect(r.via).toBeNull();
    expect(r.motivo).toContain('conteudo entregavel');
  });

  it('a regra de agendamento tem precedencia e nao e mascarada pela midia', async () => {
    // Campanha de operador com regra quebrada **e** midia no catalogo continua sendo
    // recusada: a disjuncao vale para escolher o caminho, nao para perdoar um caminho
    // defeituoso. Mascarar aqui deixaria no ar uma campanha cujo schedule MQTT aponta para
    // criativo que o player nao aceita.
    const svc = montar({
      regras: [{ assetId: 'a1' }],
      ativos: { a1: { status: 'pending' } },
      midias: 3,
    });
    const r = await svc.verificar('c1');
    expect(r.pronta).toBe(false);
    expect(r.mediaAssets).toBe(3);
  });
});
