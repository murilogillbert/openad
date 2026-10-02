import {
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import type { VehicleDecommissionResponse } from '@openad/api-contracts';
import { RemoteCommandService } from '../fleet-monitor/remote-command.service';
import { FleetDomainEventsService } from './fleet-domain-events.service';
import { PlayRecord } from '../analytics/schemas/play-record.schema';
import { DevicesRepository } from '../devices/devices.repository';
import { VehiclesRepository } from './vehicles.repository';
import { VehicleBindingAuditService } from './vehicle-binding-audit.service';

/**
 * Soft decommission (FR-009): vehicle leaves active fleet surfaces. Decommission clears pairing
 * so schedule pushes no longer target retired tablets.
 */
@Injectable()
export class VehicleDecommissionService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly vehicles: VehiclesRepository,
    private readonly devices: DevicesRepository,
    @InjectModel(PlayRecord.name)
    private readonly playRecords: Model<PlayRecord>,
    private readonly events: FleetDomainEventsService,
    private readonly bindingAudit: VehicleBindingAuditService,
    @Inject(forwardRef(() => RemoteCommandService))
    private readonly remoteCommands: RemoteCommandService
  ) {
    this.logger.setContext(VehicleDecommissionService.name);
  }

  async decommission(
    vehicleId: string,
    audit: FleetAuditContext
  ): Promise<VehicleDecommissionResponse> {
    this.logger.info(
      { ...audit, event: 'vehicle.decommission.attempt', vehicleId },
      'vehicle decommission attempt'
    );

    const vehicle = await this.vehicles.findByVehicleId(vehicleId);
    if (!vehicle) {
      this.logger.warn(
        {
          ...audit,
          event: 'vehicle.decommission.failed',
          reason: 'not_found',
          vehicleId,
        },
        'vehicle decommission rejected: not found'
      );
      throw new NotFoundException('Vehicle not found');
    }

    const affectedCampaigns = (await this.playRecords.distinct('campaignId', {
      vehicleId,
    })) as string[];

    const now = new Date();
    const paired = vehicle.pairedDeviceIds ?? [];

    for (const deviceId of paired) {
      try {
        await this.remoteCommands.issue(
          deviceId,
          { type: 'CLEAR_CACHE', payload: null },
          audit.operatorUserId
        );
      } catch (err: unknown) {
        this.logger.warn(
          {
            ...audit,
            event: 'vehicle.decommission.clear_cache_failed',
            vehicleId,
            deviceId,
            err,
          },
          'CLEAR_CACHE failed during decommission; continuing'
        );
      }
    }

    await this.vehicles.updateOne(
      { vehicleId },
      {
        $set: {
          status: 'decommissioned',
          pairedDeviceIds: [],
          decommissionedAt: now,
        },
      }
    );

    for (const deviceId of paired) {
      await this.devices.updateOne(
        { deviceId, boundVehicleId: vehicleId },
        {
          $set: {
            lifecycleState: 'Retired',
            boundVehicleId: null,
            boundAt: null,
          },
        }
      );
    }

    await this.bindingAudit.append(
      { action: 'decommission', vehicleId, deviceId: null },
      audit
    );

    this.events.vehicleDecommissioned$.next({
      vehicleId,
      affectedCampaignIds: affectedCampaigns,
    });

    this.logger.info(
      {
        ...audit,
        event: 'vehicle.decommission.success',
        vehicleId,
        affectedCampaignCount: affectedCampaigns.length,
        hadBoundDevice: paired.length > 0,
      },
      'vehicle decommissioned'
    );

    return {
      vehicleId,
      status: 'decommissioned',
      affectedCampaigns,
    };
  }
}
