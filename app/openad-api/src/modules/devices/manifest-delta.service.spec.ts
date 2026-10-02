import type { ManifestAssetRow } from './manifest-delta.util';
import { computeManifestDelta } from './manifest-delta.util';
import { ManifestDeltaService } from './manifest-delta.service';
import { ManifestVersionsRepository } from './manifest-versions.repository';

describe('computeManifestDelta', () => {
  const v1: ManifestAssetRow[] = [
    {
      assetId: 'a1',
      url: 'https://cdn.example/a1',
      checksumSha256: '00',
      sizeBytes: 100,
    },
    {
      assetId: 'a2',
      url: 'https://cdn.example/a2',
      checksumSha256: '11',
      sizeBytes: 200,
    },
  ];

  const v2: ManifestAssetRow[] = [
    v1[0],
    {
      assetId: 'a3',
      url: 'https://cdn.example/a3',
      checksumSha256: '22',
      sizeBytes: 300,
    },
  ];

  it('full sync when sinceVersion omitted or 0', () => {
    const r = computeManifestDelta(undefined, null, 2, v2);
    expect(r.fullSync).toBe(true);
    expect(r.version).toBe(2);
    expect(r.added).toHaveLength(2);
    expect(r.removed).toEqual([]);
  });

  it('empty delta when already at latest', () => {
    const r = computeManifestDelta(2, v2, 2, v2);
    expect(r.fullSync).toBe(false);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  it('delta adds and removes between versions', () => {
    const r = computeManifestDelta(1, v1, 2, v2);
    expect(r.fullSync).toBe(false);
    expect(r.added.map((a) => a.assetId)).toEqual(['a3']);
    expect(r.removed).toEqual(['a2']);
  });

  it('full sync when prior snapshot missing', () => {
    const r = computeManifestDelta(1, null, 2, v2);
    expect(r.fullSync).toBe(true);
    expect(r.added).toEqual(v2);
  });
});

describe('ManifestDeltaService', () => {
  it('delegates to repository snapshots', async () => {
    const versions = {
      findLatest: jest.fn().mockResolvedValue({
        manifestVersion: 3,
        assets: [
          {
            assetId: 'x',
            url: 'https://x',
            checksumSha256: 'ab',
            sizeBytes: 1,
          },
        ],
      }),
      findByVersion: jest.fn().mockResolvedValue(null),
    };
    const svc = new ManifestDeltaService(
      versions as unknown as ManifestVersionsRepository
    );
    const r = await svc.getDelta(2);
    expect(r.version).toBe(3);
    expect(r.fullSync).toBe(true);
    expect(versions.findByVersion).toHaveBeenCalledWith(2);
  });
});
