import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { HashGeneratorService } from './hash-generator.service';

describe('HashGeneratorService', () => {
  it('sha256Buffer matches crypto', () => {
    const svc = new HashGeneratorService();
    const buf = Buffer.from('vfs-bytes');
    expect(svc.sha256Buffer(buf)).toBe(
      createHash('sha256').update(buf).digest('hex')
    );
  });

  it('SHA-256 matches crypto for file contents', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hash-gen-'));
    const p = path.join(dir, 'f.bin');
    const buf = Buffer.from('hello-media');
    await fs.writeFile(p, buf);
    const svc = new HashGeneratorService();
    const h = await svc.sha256File(p);
    const expected = createHash('sha256').update(buf).digest('hex');
    expect(h).toBe(expected);
  });
});
