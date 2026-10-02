import { z } from 'zod';

export enum PriorityLevel {
  EMERGENCY = 'emergency',
  HIGH = 'high',
  STANDARD = 'standard',
}

/** Device-specific or broadcast priority ad command (004). */
export const priorityCommandSchema = z.object({
  commandId: z.string().uuid(),
  mediaId: z.string().uuid(),
  priority: z.nativeEnum(PriorityLevel),
  expiresAt: z.string(),
  targetDeviceId: z.string().uuid().optional(),
  broadcast: z.boolean().optional(),
});

export type PriorityCommandPayload = z.infer<typeof priorityCommandSchema>;
