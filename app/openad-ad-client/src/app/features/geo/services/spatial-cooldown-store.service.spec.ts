import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SpatialCooldownStoreService } from './spatial-cooldown-store.service';

describe('SpatialCooldownStoreService', () => {
  let svc: SpatialCooldownStoreService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(SpatialCooldownStoreService);
  });

  it('records and reads last fire time', async () => {
    const z = '550e8400-e29b-41d4-a716-446655440000';
    const m = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    await svc.setLastFireMs(z, m, 42);
    const t = await svc.getLastFireMs(z, m);
    expect(t).toBe(42);
  });
});
