import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { VehicleBindingAuditRepository } from './vehicle-binding-audit.repository';
import type { VehicleBindingAuditDocument } from './vehicle-binding-audit.schema';

export type BindingAuditAction =
  | 'pair'
  | 'unpair'
  | 'decommission'
  | 'driver_bind'
  | 'driver_unbind';

@Injectable()
export class VehicleBindingAuditService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly audit: VehicleBindingAuditRepository
  ) {
    this.logger.setContext(VehicleBindingAuditService.name);
  }

  async append(
    input: {
      action: BindingAuditAction;
      vehicleId: string;
      deviceId: string | null;
    },
    ctx: FleetAuditContext
  ): Promise<VehicleBindingAuditDocument> {
    const eventId = randomUUID();
    const doc = await this.audit.create({
      eventId,
      action: input.action,
      vehicleId: input.vehicleId,
      deviceId: input.deviceId,
      actorUserId: ctx.operatorUserId,
      actorEmail: ctx.operatorEmail,
      correlationId: ctx.correlationId,
    });
    this.logger.info(
      {
        event: 'vehicle.binding.audit',
        eventId,
        action: input.action,
        vehicleId: input.vehicleId,
        deviceId: input.deviceId,
        correlationId: ctx.correlationId,
      },
      'binding audit persisted'
    );
    return doc;
  }
}
