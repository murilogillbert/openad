import { Injectable } from '@angular/core';

/**
 * SHA-256 over binary content using the Web Crypto API (browser / secure contexts).
 */
@Injectable({ providedIn: 'root' })
export class HashVerifierService {
  async sha256Hex(buffer: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, '0');
    }
    return hex;
  }

  /** Compare API `hash` field (hex) to buffer digest. */
  async verifyHex(buffer: ArrayBuffer, expectedHex: string): Promise<boolean> {
    const actual = await this.sha256Hex(buffer);
    return actual.toLowerCase() === expectedHex.trim().toLowerCase();
  }
}
