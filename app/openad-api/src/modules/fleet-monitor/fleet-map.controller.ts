import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type {
  FleetMapDeviceDetailResponse,
  FleetMapMetaResponse,
  FleetMapSnapshotResponse,
} from '@openad/api-contracts';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FleetMapService } from './fleet-map.service';

@Controller('fleet/map')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FleetMapController {
  constructor(private readonly fleetMap: FleetMapService) {}

  @Get('meta')
  @Roles('fleet_admin', 'fleet_operator', 'campaign_manager', 'super_admin')
  getMeta(): Promise<FleetMapMetaResponse> {
    return this.fleetMap.getMeta();
  }

  @Get('snapshot')
  @Roles('fleet_admin', 'fleet_operator', 'campaign_manager', 'super_admin')
  getSnapshot(
    @Query() query: Record<string, unknown>
  ): Promise<FleetMapSnapshotResponse> {
    return this.fleetMap.getSnapshot(query);
  }

  @Get('devices/:deviceId/detail')
  @Roles('fleet_admin', 'fleet_operator', 'campaign_manager', 'super_admin')
  getDeviceDetail(
    @Param('deviceId') deviceId: string
  ): Promise<FleetMapDeviceDetailResponse> {
    return this.fleetMap.getDeviceDetail(deviceId);
  }
}
