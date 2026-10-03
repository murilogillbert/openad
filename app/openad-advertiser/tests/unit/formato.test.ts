import { dataBrParaIso, estadoDaCampanha, formatarData, proximoPasso } from '@/lib/formato';

describe('dataBrParaIso', () => {
  it('converte dd/mm/aaaa em ISO, em UTC', () => {
    expect(dataBrParaIso('03/10/2026')).toBe('2026-10-03T00:00:00.000Z');
    expect(dataBrParaIso('03/10/2026', 23, 59)).toBe('2026-10-03T23:59:00.000Z');
  });

  it('recusa data que nao existe no calendario', () => {
    // `new Date(2026, 1, 31)` nao lança: vira 3 de marco. Aceitar isso gravaria um periodo de
    // campanha diferente do que o anunciante digitou.
    expect(dataBrParaIso('31/02/2026')).toBeNull();
    expect(dataBrParaIso('30/02/2024')).toBeNull();
    expect(dataBrParaIso('32/01/2026')).toBeNull();
    expect(dataBrParaIso('01/13/2026')).toBeNull();
  });

  it('aceita 29 de fevereiro em ano bissexto', () => {
    expect(dataBrParaIso('29/02/2028')).toBe('2028-02-29T00:00:00.000Z');
  });

  it('recusa formato errado', () => {
    for (const t of ['', '3/10/2026', '03-10-2026', '2026-10-03', 'abc', '03/10/26']) {
      expect(dataBrParaIso(t)).toBeNull();
    }
  });
});

describe('formatarData', () => {
  it('devolve texto vazio para entrada ausente ou invalida, em vez de "Invalid Date"', () => {
    expect(formatarData(null)).toBe('');
    expect(formatarData(undefined)).toBe('');
    expect(formatarData('nao e data')).toBe('');
  });

  it('formata no padrao brasileiro', () => {
    expect(formatarData('2026-10-03T12:00:00.000Z')).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

describe('estadoDaCampanha', () => {
  it('traduz os estados conhecidos', () => {
    expect(estadoDaCampanha('draft').rotulo).toBe('Rascunho');
    expect(estadoDaCampanha('active').rotulo).toBe('No ar');
    expect(estadoDaCampanha('rejected').tom).toBe('danger');
  });

  it('nao quebra com estado desconhecido vindo do servidor', () => {
    // A API pode ganhar um estado novo antes do app: mostrar o nome cru e melhor que
    // renderizar `undefined`.
    expect(estadoDaCampanha('estado_novo').rotulo).toBe('estado_novo');
    expect(estadoDaCampanha('estado_novo').tom).toBe('neutral');
  });
});

describe('proximoPasso', () => {
  it('diz para subir criativo quando o rascunho esta vazio', () => {
    const r = proximoPasso({ status: 'draft', creativeCount: 0, moderation: null });
    expect(r).toMatch(/criativo/i);
  });

  it('diz que esta pronta quando o rascunho tem criativo', () => {
    const r = proximoPasso({ status: 'draft', creativeCount: 1, moderation: null });
    expect(r).toMatch(/revis/i);
  });

  it('mostra o motivo da recusa quando existe', () => {
    const r = proximoPasso({
      status: 'rejected',
      creativeCount: 1,
      moderation: { reason: 'Texto ilegivel em movimento' },
    });
    expect(r).toContain('Texto ilegivel em movimento');
  });

  it('nao inventa passo para campanha no ar', () => {
    expect(proximoPasso({ status: 'active', creativeCount: 2, moderation: null })).toBeNull();
  });
});
