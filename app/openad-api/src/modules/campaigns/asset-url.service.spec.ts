import { AssetUrlService } from './asset-url.service';

describe('AssetUrlService', () => {
  const envBefore = { ...process.env };
  const make = () => new AssetUrlService();

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-jwt-secret-key-min-32-chars-long!!';
    process.env.PUBLIC_ASSET_BASE_URL = 'http://127.0.0.1:3000';
  });

  afterEach(() => {
    process.env = { ...envBefore };
  });

  it('builds signed URL and verifies', () => {
    const s = make();
    const { url, expiresAt } = s.buildSignedFileUrl('c1', 'a1');
    expect(url).toContain('exp=');
    expect(url).toContain('sig=');
    const u = new URL(url);
    const exp = u.searchParams.get('exp')!;
    const sig = u.searchParams.get('sig')!;
    expect(s.verifySignedRequest('c1', 'a1', exp, sig)).toBe(true);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects bad signature', () => {
    const s = make();
    const { url } = s.buildSignedFileUrl('c1', 'a1');
    const u = new URL(url);
    const exp = u.searchParams.get('exp')!;
    expect(() =>
      s.verifySignedRequest('c1', 'a1', exp, 'deadbeef')
    ).toThrow();
  });
});
