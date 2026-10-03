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
