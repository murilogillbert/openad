import {
  hardwareFingerprintHash,
  isFingerprintUnavailable,
  normaliseMacAddress,
} from './hardware-fingerprint.util';

describe('hardware-fingerprint.util', () => {
  it('normalises MAC to uppercase colon-separated', () => {
    expect(normaliseMacAddress('aa:bb:cc:dd:ee:ff')).toBe('AA:BB:CC:DD:EE:FF');
    expect(normaliseMacAddress('aabbccddeeff')).toBe('AA:BB:CC:DD:EE:FF');
  });

  it('produces stable hash for same tuple', () => {
    const a = hardwareFingerprintHash({
      imei: null,
      serialNumber: 'SN-1',
      macAddress: '00:11:22:33:44:55',
    });
    const b = hardwareFingerprintHash({
      imei: null,
      serialNumber: 'SN-1',
      macAddress: '00:11:22:33:44:55',
    });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('changes hash when serial changes', () => {
    const a = hardwareFingerprintHash({
      imei: null,
      serialNumber: 'A',
      macAddress: '00:11:22:33:44:55',
    });
    const b = hardwareFingerprintHash({
      imei: null,
      serialNumber: 'B',
      macAddress: '00:11:22:33:44:55',
    });
    expect(a).not.toBe(b);
  });

  it('treats missing serial and mac as unavailable', () => {
    expect(
      isFingerprintUnavailable({
        imei: null,
        serialNumber: '',
        macAddress: '',
      })
    ).toBe(true);
  });

  it('allows serial-only fingerprint', () => {
    expect(
      isFingerprintUnavailable({
        imei: null,
        serialNumber: 'X',
        macAddress: '',
      })
    ).toBe(false);
  });
});
