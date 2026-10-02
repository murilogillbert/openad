/**
 * Vehicle lifecycle & device binding — Zod contracts (008).
 * Keep in sync with NestJS DTOs and `libs/api-contracts/src/lib/types.ts`.
 */
import { z } from 'zod';

export const vehiclePairRequestSchema = z.object({
  deviceId: z.string().uuid(),
});

export const vehicleUnpairRequestSchema = z.object({
  deviceId: z.string().uuid(),
});

export const createVehicleRequestSchema = z.object({
  registrationPlate: z.string().min(1),
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  commercialTier: z.enum(['premium', 'taxi', 'van', 'other']).optional(),
  driverId: z.string().uuid().nullable().optional(),
  pairedDeviceIds: z.array(z.string().uuid()).max(32).optional(),
});

export const vehicleBindingStatusSchema = z.enum([
  'fully_operational',
  'hardware_missing',
  'hardware_offline',
  'in_shop',
]);

export const vehicleListItemWithBindingSchema = z.object({
  vehicleId: z.string().uuid(),
  registrationPlate: z.string(),
  make: z.string(),
  model: z.string(),
  status: z.string(),
  commercialTier: z.string().optional(),
  driverId: z.string().uuid().nullable().optional(),
  bindingStatus: vehicleBindingStatusSchema,
  pairedDeviceIds: z.array(z.string().uuid()),
});

export const vehicleBindingAuditEntrySchema = z.object({
  eventId: z.string().uuid(),
  action: z.enum(['pair', 'unpair', 'decommission']),
  vehicleId: z.string().uuid(),
  deviceId: z.string().uuid().nullable(),
  actorUserId: z.string(),
  createdAt: z.string().datetime(),
});

export const vehicleBindingAuditListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  deviceId: z.string().uuid().optional(),
});

export const vehicleBindingAuditListResponseSchema = z.object({
  items: z.array(vehicleBindingAuditEntrySchema),
  nextCursor: z.string().nullable().optional(),
});

export type VehiclePairRequest = z.infer<typeof vehiclePairRequestSchema>;
export type VehicleUnpairRequest = z.infer<typeof vehicleUnpairRequestSchema>;
