import { z } from 'zod';

/** Server → device: trigger the same path as a daily update check (009). */
export const checkAppUpdatesCommandSchema = z.object({
  commandId: z.string().uuid(),
  type: z.literal('CHECK_APP_UPDATES'),
  issuedAt: z.string(),
  expiresAt: z.string(),
  payload: z.null(),
});

export type CheckAppUpdatesCommandPayload = z.infer<
  typeof checkAppUpdatesCommandSchema
>;
