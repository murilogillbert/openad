import { Injectable } from '@angular/core';
import { Device } from '@capacitor/device';

/** Mirrors server `hardware-fingerprint.util.ts` tuple + SHA-256. */
export interface HardwareFingerprintComponents {
  imei: string | null;
  serialNumber: string;
  macAddress: string;
}

function normaliseMacAddress(mac: string): string {
  const s = mac.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (s.length < 12) {
    return mac.trim().toUpperCase();
  }
  const pairs = s.match(/.{1,2}/g) ?? [];
  return pairs.join(':');
}

@Injectable({ providedIn: 'root' })
export class HardwareFingerprintService {
  /**
   * Collects identifiers (best-effort). On web, values are placeholders unless extended with native plugins.
   */
  async collect(): Promise<
    HardwareFingerprintComponents | { flag: 'FINGERPRINT_UNAVAILABLE' }
  > {
    try {
      const id = await Device.getId();
      const serialNumber = (id.identifier ?? '').trim() || 'unknown-device';
      const macAddress = '02:00:00:00:00:01';
      const imei: string | null = null;

      if (serialNumber.length === 0 && macAddress.trim().length === 0) {
        return { flag: 'FINGERPRINT_UNAVAILABLE' as const };
      }
      return { imei, serialNumber, macAddress };
    } catch {
      return { flag: 'FINGERPRINT_UNAVAILABLE' as const };
    }
  }

  /** Canonical SHA-256 hex (must match API `hardwareFingerprintHash`). */
  async hashFingerprint(input: HardwareFingerprintComponents): Promise<string> {
    const imei = (input.imei ?? '').trim().toLowerCase();
    const serial = input.serialNumber.trim();
    const mac = normaliseMacAddress(input.macAddress);
    const tuple = `${imei}|${serial}|${mac}`;
    const data = new TextEncoder().encode(tuple);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  isUnavailable(
    input: HardwareFingerprintComponents
  ): boolean {
    return (
      input.serialNumber.trim().length === 0 &&
      input.macAddress.trim().length === 0
    );
  }
}
