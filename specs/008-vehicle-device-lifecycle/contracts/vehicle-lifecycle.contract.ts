/**
 * HTTP contract sketches for 008 vehicle lifecycle (design artifact).
 * Mirror into `libs/api-contracts` during implementation; keep in sync with NestJS DTOs.
 */
import { z } from 'zod';

export const vehiclePairRequestSchema = z.object({
  deviceId: z.string().uuid(),
});

export const vehicleUnpairRequestSchema = z.object({
  deviceId: z.string().uuid(),
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
export type VehicleBindingStatus = z.infer<typeof vehicleBindingStatusSchema>;
export type VehicleBindingAuditListQuery = z.infer<
  typeof vehicleBindingAuditListQuerySchema
>;
export type VehicleBindingAuditListResponse = z.infer<
  typeof vehicleBindingAuditListResponseSchema
>;
