import { Injectable } from '@angular/core';

export interface ResumableDownloadOptions {
  getOffset: () => Promise<number>;
  setOffset: (n: number) => Promise<void>;
  fetchFn?: typeof fetch;
}

/**
 * HTTP GET with `Range` resume; concatenates partial bodies until `Content-Range` total is reached.
 */
@Injectable({ providedIn: 'root' })
export class ResumableDownloadService {
  async downloadToBuffer(url: string, opts: ResumableDownloadOptions): Promise<ArrayBuffer> {
    const fetchFn = opts.fetchFn ?? fetch;
    const parts: Uint8Array[] = [];
    let offset = await opts.getOffset();

    while (true) {
      const headers: Record<string, string> = {};
      if (offset > 0) {
        headers['Range'] = `bytes=${offset}-`;
      }
      const res = await fetchFn(url, { headers });

      if (res.status === 416 && offset > 0) {
        await opts.setOffset(0);
        offset = 0;
        parts.length = 0;
        continue;
      }

      if (!res.ok && res.status !== 206) {
        throw new Error(`HTTP ${res.status}`);
      }

      if (res.status === 200) {
        const buf = await res.arrayBuffer();
        await opts.setOffset(buf.byteLength);
        return buf;
      }

      const chunk = new Uint8Array(await res.arrayBuffer());
      parts.push(chunk);
      offset += chunk.byteLength;
      await opts.setOffset(offset);

      const total = this.parseTotalFromContentRange(res.headers.get('Content-Range'));
      if (total !== null && offset >= total) {
        return this.concat(parts);
      }
    }
  }

  private parseTotalFromContentRange(header: string | null): number | null {
    if (!header) {
      return null;
    }
    const m = /\/(\d+)/.exec(header);
    if (m?.[1]) {
      return Number(m[1]);
    }
    return null;
  }

  private concat(parts: Uint8Array[]): ArrayBuffer {
    const len = parts.reduce((a, p) => a + p.byteLength, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out.buffer;
  }
}
