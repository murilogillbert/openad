import { z } from 'zod';

/** GET /api/v1/devices/:deviceId/session — device JWT + fingerprint. */
export const deviceSessionResponseSchema = z.object({
  deviceId: z.string().uuid(),
  boundVehicleId: z.string().uuid().nullable(),
});

export type DeviceSessionResponse = z.infer<typeof deviceSessionResponseSchema>;
