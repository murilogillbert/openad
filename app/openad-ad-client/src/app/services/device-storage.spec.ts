import { afterEach, describe, expect, it, vi } from 'vitest';
import { emGigabytes, estimarArmazenamento } from './device-storage';

const navegadorOriginal = globalThis.navigator;

function comEstimate(
  estimate: (() => Promise<{ quota?: number; usage?: number }>) | undefined
) {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: estimate ? { storage: { estimate } } : {},
  });
}

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: navegadorOriginal,
  });
  vi.restoreAllMocks();
});

const GB = 1024 ** 3;

describe('estimarArmazenamento', () => {
  it('usa storage.estimate quando disponivel', async () => {
    comEstimate(async () => ({ quota: 8 * GB, usage: 2 * GB }));
    const r = await estimarArmazenamento();
    expect(r.fonte).toBe('storage_estimate');
    expect(r.totalBytes).toBe(8 * GB);
    expect(r.availableBytes).toBe(6 * GB);
  });

  it('nao devolve disponivel negativo quando o uso passa a quota', async () => {
    comEstimate(async () => ({ quota: 1 * GB, usage: 3 * GB }));
    const r = await estimarArmazenamento();
    expect(r.availableBytes).toBe(0);
  });

  it('cai no orcamento assumido sem storage.estimate', async () => {
    comEstimate(undefined);
    const r = await estimarArmazenamento(100 * 1024 * 1024);
    expect(r.fonte).toBe('orcamento_assumido');
    expect(r.availableBytes).toBe(512 * 1024 * 1024 - 100 * 1024 * 1024);
  });

  it('cai no orcamento assumido quando estimate lanca', async () => {
    comEstimate(async () => {
      throw new Error('nao suportado');
    });
    const r = await estimarArmazenamento();
    expect(r.fonte).toBe('orcamento_assumido');
  });

  it('cai no orcamento assumido quando a quota vem zerada', async () => {
    comEstimate(async () => ({ quota: 0, usage: 0 }));
    const r = await estimarArmazenamento();
    expect(r.fonte).toBe('orcamento_assumido');
  });

  /**
   * O numero que o codigo antigo produzia: `Filesystem.stat` devolvia 3452 bytes (tamanho do
   * diretorio) e isso era tratado como espaco livre. Com 37154 bytes de criativo, a
   * sincronizacao abortava com `storage_full` num aparelho vazio.
   */
  it('o caminho de reserva comporta um criativo tipico', async () => {
    comEstimate(undefined);
    const r = await estimarArmazenamento();
    expect(r.availableBytes).toBeGreaterThan(37_154);
  });
});

describe('emGigabytes', () => {
  it('garante available <= total', async () => {
    // Era exatamente o que a API recusava com 400: total 1, available 16.
    const r = emGigabytes({
      totalBytes: 3452,
      availableBytes: 16 * GB,
      fonte: 'orcamento_assumido',
    });
    expect(r.totalStorageGb).toBe(1);
    expect(r.availableStorageGb).toBeLessThanOrEqual(r.totalStorageGb);
  });

  it('total minimo de 1 GB', () => {
    const r = emGigabytes({ totalBytes: 10, availableBytes: 0, fonte: 'orcamento_assumido' });
    expect(r.totalStorageGb).toBe(1);
    expect(r.availableStorageGb).toBe(0);
  });

  it('arredonda para gigabyte inteiro', () => {
    const r = emGigabytes({
      totalBytes: 64 * GB,
      availableBytes: 20 * GB,
      fonte: 'storage_estimate',
    });
    expect(r).toEqual({ totalStorageGb: 64, availableStorageGb: 20 });
  });
});
