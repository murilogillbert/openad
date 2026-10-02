import { DeltaCalculatorService } from './delta-calculator.service';

describe('DeltaCalculatorService', () => {
  const svc = new DeltaCalculatorService();

  it('returns JSON Patch ops between two manifest shapes', () => {
    const prev = {
      deviceId: 'a',
      version: 'v1',
      media: [{ mediaId: 'm1', hash: 'h1' }],
    };
    const next = {
      deviceId: 'a',
      version: 'v2',
      media: [
        { mediaId: 'm1', hash: 'h1' },
        { mediaId: 'm2', hash: 'h2' },
      ],
    };
    const ops = svc.computeDelta(prev, next);
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.some((o) => o.op === 'replace' || o.op === 'add')).toBe(true);
  });
});
