import { serverCommandPayloadSchema } from '@openad/mqtt-contracts';

describe('MQTT server→device commands payload (contract)', () => {
  it('validates openad/{deviceId}/commands payload', () => {
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86400000).toISOString();
    const payload = {
      commandId: '660e8400-e29b-41d4-a716-446655440001',
      type: 'RESTART' as const,
      issuedAt: now,
      expiresAt: expires,
      payload: null,
    };

    const parsed = serverCommandPayloadSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
  });

  it('allows CUSTOM with object payload', () => {
    const payload = {
      commandId: '770e8400-e29b-41d4-a716-446655440002',
      type: 'CUSTOM' as const,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      payload: { key: 'value' },
    };

    expect(serverCommandPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it('validates TEMP_DISABLE_KIOSK payload', () => {
    const payload = {
      commandId: '880e8400-e29b-41d4-a716-446655440003',
      type: 'TEMP_DISABLE_KIOSK' as const,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      payload: { durationSeconds: 300, reason: 'maintenance' },
    };
    expect(serverCommandPayloadSchema.safeParse(payload).success).toBe(true);
  });
});
