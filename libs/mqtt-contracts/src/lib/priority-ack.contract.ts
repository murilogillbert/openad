import { z } from 'zod';

/** Device → server on `devices/{deviceId}/priority/ack`. */
export const priorityAckSchema = z.object({
  deviceId: z.string().uuid(),
  commandId: z.string().uuid(),
  status: z.enum(['received', 'played', 'failed', 'expired', 'skipped']),
  timestamp: z.string(),
});

export type PriorityAckPayload = z.infer<typeof priorityAckSchema>;
