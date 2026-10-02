import { describe, it, expect } from 'vitest';
import { HashVerifierService } from './hash-verifier.service';

describe('HashVerifierService', () => {
  it('sha256Hex matches known empty digest', async () => {
    const svc = new HashVerifierService();
    const enc = new TextEncoder();
    const hex = await svc.sha256Hex(enc.encode('').buffer);
    expect(hex).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('verifyHex returns true for matching content', async () => {
    const svc = new HashVerifierService();
    const enc = new TextEncoder();
    const buf = enc.encode('hello').buffer;
    const expected = await svc.sha256Hex(buf);
    await expect(svc.verifyHex(buf, expected)).resolves.toBe(true);
  });
});
