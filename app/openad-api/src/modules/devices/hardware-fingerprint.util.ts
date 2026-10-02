import { createHash } from 'crypto';

/** Normalised MAC: uppercase hex pairs with colons (e.g. AA:BB:CC:DD:EE:FF). */
export function normaliseMacAddress(mac: string): string {
  const s = mac.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
  if (s.length < 12) {
    return mac.trim().toUpperCase();
  }
  const pairs = s.match(/.{1,2}/g) ?? [];
  return pairs.join(':');
}

export interface HardwareFingerprintInput {
  imei: string | null;
  serialNumber: string;
  macAddress: string;
}

/**
 * Canonical SHA-256 for hardware binding (must match tablet + JWT `fp` claim).
 * Tuple order: imei | serial | mac (normalised).
 */
export function hardwareFingerprintHash(input: HardwareFingerprintInput): string {
  const imei = (input.imei ?? '').trim().toLowerCase();
  const serial = input.serialNumber.trim();
  const mac = normaliseMacAddress(input.macAddress);
  const tuple = `${imei}|${serial}|${mac}`;
  return createHash('sha256').update(tuple, 'utf8').digest('hex');
}

export function isFingerprintUnavailable(input: HardwareFingerprintInput): boolean {
  const serial = input.serialNumber?.trim() ?? '';
  const mac = input.macAddress?.trim() ?? '';
  return serial.length === 0 && mac.length === 0;
}
