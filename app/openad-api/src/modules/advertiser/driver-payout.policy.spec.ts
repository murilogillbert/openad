import type { PlatformConfig } from '@openad/api-contracts';
import { platformConfigDefaults } from '../platform-config/platform-config.service';
import { validarRepasse } from './driver-payout.policy';

describe('validarRepasse', () => {
  function configComPiso(piso: number): PlatformConfig {
    const base = platformConfigDefaults();
    return {
      ...base,
      monetization: { ...base.monetization, driverPayoutMinPercent: piso },
    };
  }

  it('sem repasse declarado, herda o piso da plataforma', () => {
    // Exigir o campo faria toda campanha antiga e todo cliente que nao o conhece falhar na
    // criacao. Herdar o piso mantem o motorista pago por padrao.
    const r = validarRepasse(null, 100, configComPiso(0.3));
    expect(r.erro).toBeNull();
    expect(r.repasse).toEqual({
      model: 'percent',
      percent: 0.3,
      valueCents: null,
      percentEfetivo: 0.3,
    });
  });

  describe('model: percent', () => {
    it('aceita no piso exato', () => {
      const r = validarRepasse(
        { model: 'percent', percent: 0.3 },
        100,
        configComPiso(0.3)
      );
      expect(r.erro).toBeNull();
      expect(r.repasse?.percentEfetivo).toBe(0.3);
    });

    it('recusa abaixo do piso, dizendo os dois numeros', () => {
      const r = validarRepasse(
        { model: 'percent', percent: 0.2 },
        100,
        configComPiso(0.3)
      );
      expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_BELOW_FLOOR');
      // A mensagem carrega o valor ofertado e o piso: sem isso o anunciante recebe "recusado"
      // e nao sabe para quanto corrigir.
      expect(r.erro?.mensagem).toContain('20.0%');
      expect(r.erro?.mensagem).toContain('30.0%');
    });

    it('recusa model percent sem percent', () => {
      const r = validarRepasse({ model: 'percent' }, 100, configComPiso(0.3));
      expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_PERCENT_REQUIRED');
    });
  });

  describe('model: per_play', () => {
    it('normaliza valor fixo para fracao da tarifa', () => {
      const r = validarRepasse(
        { model: 'per_play', valueCents: 40 },
        100,
        configComPiso(0.3)
      );
      expect(r.erro).toBeNull();
      expect(r.repasse?.percentEfetivo).toBeCloseTo(0.4, 10);
    });

    it('recusa quando o valor fixo equivale a menos que o piso', () => {
      const r = validarRepasse(
        { model: 'per_play', valueCents: 20 },
        100,
        configComPiso(0.3)
      );
      expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_BELOW_FLOOR');
    });

    it('recusa repasse acima da tarifa, que pagaria mais do que arrecada', () => {
      const r = validarRepasse(
        { model: 'per_play', valueCents: 150 },
        100,
        configComPiso(0.3)
      );
      expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_ABOVE_REVENUE');
    });

    it('recusa repasse fixo sobre tarifa zero em vez de dividir por zero', () => {
      // Sem esta guarda, `valueCents / 0` da `Infinity`, que passa pela comparacao com o
      // piso e gravaria um repasse impossivel numa campanha que nao fatura nada.
      const r = validarRepasse(
        { model: 'per_play', valueCents: 50 },
        0,
        configComPiso(0.3)
      );
      expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_WITHOUT_REVENUE');
    });

    it('recusa model per_play sem valueCents', () => {
      const r = validarRepasse({ model: 'per_play' }, 100, configComPiso(0.3));
      expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_VALUE_REQUIRED');
    });
  });

  it('piso zero desliga a politica sem desligar a normalizacao', () => {
    // `driverPayoutMinPercent: 0` e a saida de emergencia se o piso surpreender em producao.
    const r = validarRepasse(
      { model: 'percent', percent: 0 },
      100,
      configComPiso(0)
    );
    expect(r.erro).toBeNull();
    expect(r.repasse?.percentEfetivo).toBe(0);
  });
});

describe('validarRepasse: teto de repasse', () => {
  /**
   * O teto existe pelo mesmo motivo que o piso, do outro lado.
   *
   * Antes, `percent` aceitava qualquer valor até 100% — o `@Max(1)` do DTO era o único limite
   * — e a plataforma não retinha nada daquela veiculação. O teto é política: mora no
   * `platform_config` e muda sem deploy.
   */
  function configComFaixa(piso: number, teto: number): PlatformConfig {
    const base = platformConfigDefaults();
    return {
      ...base,
      monetization: {
        ...base.monetization,
        driverPayoutMinPercent: piso,
        driverPayoutMaxPercent: teto,
      },
    };
  }

  it('o padrao da plataforma e piso 30% e teto 80%', () => {
    const m = platformConfigDefaults().monetization;
    expect(m.driverPayoutMinPercent).toBe(0.3);
    expect(m.driverPayoutMaxPercent).toBe(0.8);
  });

  it('aceita no teto exato', () => {
    const r = validarRepasse(
      { model: 'percent', percent: 0.8 },
      100,
      configComFaixa(0.3, 0.8)
    );
    expect(r.erro).toBeNull();
    expect(r.repasse?.percentEfetivo).toBe(0.8);
  });

  it('recusa percent acima do teto, dizendo os dois numeros', () => {
    const r = validarRepasse(
      { model: 'percent', percent: 0.9 },
      100,
      configComFaixa(0.3, 0.8)
    );
    expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_ABOVE_CAP');
    expect(r.erro?.mensagem).toContain('90.0%');
    expect(r.erro?.mensagem).toContain('80.0%');
    expect(r.repasse).toBeNull();
  });

  it('recusa per_play acima do teto', () => {
    // 85 centavos sobre uma tarifa de 100 equivale a 85%, acima do teto.
    const r = validarRepasse(
      { model: 'per_play', valueCents: 85 },
      100,
      configComFaixa(0.3, 0.8)
    );
    expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_ABOVE_CAP');
  });

  it('per_play acima da tarifa recusa por receita, nao por teto', () => {
    /**
     * As duas recusas existem e a ordem importa: "excede a tarifa" diz ao anunciante algo
     * diferente de "acima do teto". Trocar a ordem faria a mensagem falar de política quando o
     * problema é aritmético.
     */
    const r = validarRepasse(
      { model: 'per_play', valueCents: 150 },
      100,
      configComFaixa(0.3, 0.8)
    );
    expect(r.erro?.codigo).toBe('DRIVER_PAYOUT_ABOVE_REVENUE');
  });

  it('teto ausente na configuracao nao recusa nada', () => {
    /**
     * Campanha avaliada contra configuração gravada antes desta chave existir. Sem o padrão 1,
     * `undefined` em toda comparação recusaria qualquer repasse — uma mudança de configuração
     * derrubaria a criação de campanha inteira.
     */
    const base = platformConfigDefaults();
    const semTeto = {
      ...base,
      monetization: {
        ...base.monetization,
        driverPayoutMinPercent: 0.3,
        driverPayoutMaxPercent: undefined as unknown as number,
      },
    } as PlatformConfig;
    const r = validarRepasse({ model: 'percent', percent: 0.95 }, 100, semTeto);
    expect(r.erro).toBeNull();
    expect(r.repasse?.percentEfetivo).toBe(0.95);
  });
});
