import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

export interface DeviceUnboundEvent {
  deviceId: string;
}

export interface VehicleDecommissionedEvent {
  vehicleId: string;
  affectedCampaignIds: string[];
}

/** In-process hooks for future MQTT / queue consumers (US3+). */
@Injectable()
export class FleetDomainEventsService {
  readonly deviceUnbound$ = new Subject<DeviceUnboundEvent>();
  readonly vehicleDecommissioned$ = new Subject<VehicleDecommissionedEvent>();
}
