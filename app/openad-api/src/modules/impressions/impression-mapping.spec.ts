import {
  impressionLocationVerified,
  snapshotBillingValueCents,
} from './impression-mapping';

describe('impression mapping (US4)', () => {
  it('sets locationVerified from gpsLocked', () => {
    expect(impressionLocationVerified(true)).toBe(true);
    expect(impressionLocationVerified(false)).toBe(false);
  });

  it('congela a tarifa da campanha como valor faturavel', () => {
    expect(snapshotBillingValueCents(5)).toBe(5);
    expect(snapshotBillingValueCents(0)).toBe(0);
  });

  it('nao grava fracao de centavo nem valor negativo', () => {
    // O campo e inteiro no schema. Truncar aqui, em vez de arredondar, e deliberado: a
    // versao anterior fazia `Math.max(1, Math.round(rate * 100))` e cobrava um centavo de
    // campanha com tarifa zero — inventario institucional virava receita fantasma.
    expect(snapshotBillingValueCents(7.9)).toBe(7);
    expect(snapshotBillingValueCents(-3)).toBe(0);
  });
});
