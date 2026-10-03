import {
  TargetingMatcherService,
  type ContextoDoDispositivo,
  type Segmentacao,
} from './targeting-matcher.service';

/**
 * A regra de alcance é função pura dentro do serviço, então pode ser exercitada sem Mongo:
 * `alcanca` não toca banco nenhum. A resolução de contexto (`contextoDe`), que consulta
 * device, veículo e zonas, é coberta pela integração do manifesto.
 */
describe('TargetingMatcherService.alcanca', () => {
  // `alcanca` não usa nenhuma dependência injetada.
  const svc = new TargetingMatcherService(
    null as never,
    null as never,
    null as never
  );

  function ctx(over: Partial<ContextoDoDispositivo> = {}): ContextoDoDispositivo {
    return {
      deviceId: 'd-1',
      vehicleId: 'v-1',
      vehicleTier: 'taxi',
      zoneIds: ['z-1'],
      cities: ['Cuiabá'],
      zoneTiers: ['T2'],
      agora: new Date('2026-04-05T08:30:00Z'),
      ...over,
    };
  }

  function seg(over: Partial<Segmentacao> = {}): Segmentacao {
    return {
      cities: [],
      zoneIds: [],
      tiers: [],
      vehicleTiers: [],
      dayparts: [],
      ...over,
    };
  }

  it('sem segmentacao, alcanca', () => {
    expect(svc.alcanca(null, ctx()).ok).toBe(true);
  });

  it('dimensao vazia significa sem restricao', () => {
    // É a convenção do schema (`default: []`) e o que mantém compatível toda campanha
    // criada antes de `targeting` existir.
    expect(svc.alcanca(seg(), ctx()).ok).toBe(true);
  });

  describe('cidade', () => {
    it('casa ignorando acento e caixa', () => {
      expect(svc.alcanca(seg({ cities: ['cuiaba'] }), ctx()).ok).toBe(true);
      expect(svc.alcanca(seg({ cities: ['CUIABÁ'] }), ctx()).ok).toBe(true);
    });

    it('recusa cidade diferente, com motivo', () => {
      const r = svc.alcanca(seg({ cities: ['Sinop'] }), ctx());
      expect(r.ok).toBe(false);
      expect(r.motivo).toBe('targeting_city');
    });
  });

  describe('zona e tier de zona', () => {
    it('recusa quando o tablete nao esta em nenhuma zona pedida', () => {
      const r = svc.alcanca(seg({ zoneIds: ['z-9'] }), ctx());
      expect(r.motivo).toBe('targeting_zone');
    });

    it('aceita quando ha intersecao', () => {
      expect(
        svc.alcanca(seg({ zoneIds: ['z-9', 'z-1'] }), ctx()).ok
      ).toBe(true);
    });

    it('recusa por tier de zona', () => {
      const r = svc.alcanca(seg({ tiers: ['T1'] }), ctx());
      expect(r.motivo).toBe('targeting_zone_tier');
    });
  });

  describe('sem GPS', () => {
    const semGeo = ctx({ zoneIds: [], cities: [], zoneTiers: [] });

    it('segmentacao geografica nao e avaliada e a campanha passa', () => {
      /**
       * Deliberadamente permissivo. O tablete perde sinal em túnel, garagem e
       * estacionamento coberto; tratar isso como "não alcança" tiraria do ar toda campanha
       * segmentada justamente onde o veículo fica parado mais tempo. A exigência dura de
       * posição é na verificação de geofence do play faturável — é lá que vira dinheiro.
       */
      expect(svc.alcanca(seg({ cities: ['Sinop'] }), semGeo).ok).toBe(true);
      expect(svc.alcanca(seg({ zoneIds: ['z-9'] }), semGeo).ok).toBe(true);
      expect(svc.alcanca(seg({ tiers: ['T1'] }), semGeo).ok).toBe(true);
    });

    it('tier de veiculo continua valendo, porque nao depende de posicao', () => {
      const r = svc.alcanca(seg({ vehicleTiers: ['premium'] }), semGeo);
      expect(r.motivo).toBe('targeting_vehicle_tier');
    });
  });

  describe('tier de veiculo', () => {
    it('aceita quando casa', () => {
      expect(
        svc.alcanca(seg({ vehicleTiers: ['taxi', 'van'] }), ctx()).ok
      ).toBe(true);
    });

    it('recusa tablete sem veiculo vinculado quando ha tier pedido', () => {
      const r = svc.alcanca(
        seg({ vehicleTiers: ['taxi'] }),
        ctx({ vehicleTier: null })
      );
      expect(r.motivo).toBe('targeting_vehicle_tier');
    });
  });

  describe('faixa horaria', () => {
    it('aceita dentro da faixa', () => {
      expect(svc.alcanca(seg({ dayparts: ['07:00-10:00'] }), ctx()).ok).toBe(
        true
      );
    });

    it('recusa fora da faixa', () => {
      const r = svc.alcanca(seg({ dayparts: ['12:00-14:00'] }), ctx());
      expect(r.motivo).toBe('targeting_daypart');
    });

    it('trata faixa que atravessa a meia-noite', () => {
      // Sem o tratamento de `inicio > fim`, uma campanha de madrugada nunca tocaria — e a
      // configuração pareceria válida, o que é o pior tipo de falha.
      const madrugada = seg({ dayparts: ['22:00-02:00'] });
      expect(
        svc.alcanca(madrugada, ctx({ agora: new Date('2026-04-05T23:30:00Z') })).ok
      ).toBe(true);
      expect(
        svc.alcanca(madrugada, ctx({ agora: new Date('2026-04-05T01:30:00Z') })).ok
      ).toBe(true);
      expect(
        svc.alcanca(madrugada, ctx({ agora: new Date('2026-04-05T12:00:00Z') })).ok
      ).toBe(false);
    });

    it('faixa malformada e ignorada em vez de recusar tudo', () => {
      // Config errada não deve tirar a campanha do ar inteira: o erro aparece como entrega
      // sem a restrição esperada, não como silêncio total.
      expect(svc.alcanca(seg({ dayparts: ['manha'] }), ctx()).ok).toBe(true);
    });

    it('qualquer faixa que case e suficiente', () => {
      expect(
        svc.alcanca(seg({ dayparts: ['12:00-14:00', '08:00-09:00'] }), ctx()).ok
      ).toBe(true);
    });
  });

  it('as dimensoes sao combinadas por conjuncao', () => {
    // Cidade casa, tier de veículo não. Disjunção faria passar, e o anunciante pagaria por
    // alcance que não pediu.
    const r = svc.alcanca(
      seg({ cities: ['Cuiabá'], vehicleTiers: ['premium'] }),
      ctx()
    );
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('targeting_vehicle_tier');
  });
});
