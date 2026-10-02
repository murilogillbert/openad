import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';

@Injectable()
export class HashGeneratorService {
  /** SHA-256 hex digest of an in-memory buffer. */
  sha256Buffer(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /** SHA-256 hex digest of file contents (streaming). */
  async sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(filePath);
      rs.on('data', (chunk: Buffer | string) => {
        hash.update(chunk);
      });
      rs.on('end', () => resolve());
      rs.on('error', (err) => reject(err));
    });
    return hash.digest('hex');
  }
}
