import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ExecutionContext,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { ManifestDeltaResponse } from '@openad/api-contracts';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import type { DeviceLifecycleEventsResponse } from '@openad/api-contracts';
import { extractFleetAuditFromRequest } from '../../infrastructure/logging/fleet-audit.context';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FleetGateway } from '../fleet-monitor/fleet-gateway';
import { RegisterInventoryDeviceDto } from './dto/register-inventory-device.dto';
import { CapabilityManifestUpdateDto } from './dto/capability-manifest.dto';
import {
  DeviceLifecycleEventsQueryDto,
  DeviceStateTransitionDto,
} from './dto/device-state-transition.dto';
import { DeviceJwtAuthGuard } from './device-jwt-auth.guard';
import { DeviceUnbindService } from './device-unbind.service';
import { DeviceLifecycleEventRepository } from './device-lifecycle-event.repository';
import { DeviceStateMachineService } from './device-state-machine.service';
import { DeviceListQueryDto } from './dto/device-list-query.dto';
import { DevicesListService } from './devices-list.service';
import { DevicesRepository } from './devices.repository';
import { RetiredDeviceGuard } from './retired-device-guard';
import { ScreenshotUploadDto } from './dto/screenshot-upload.dto';
import { WatchdogEventDto } from './dto/watchdog-event.dto';
import { ScreenshotUploadService } from './screenshot-upload.service';
import { ManifestDeltaService } from './manifest-delta.service';
import { PairingService } from './pairing.service';

type AuthedRequest = Request & {
  user: { userId: string; email: string; role: string };
};

@ApiTags('devices', 'device-state-machine')
@Controller('devices')
export class DevicesController {
  private readonly log = new Logger(DevicesController.name);

  constructor(
    private readonly unbindService: DeviceUnbindService,
    private readonly fsm: DeviceStateMachineService,
    private readonly lifecycleEvents: DeviceLifecycleEventRepository,
    private readonly devices: DevicesRepository,
    private readonly deviceList: DevicesListService,
    private readonly gateway: FleetGateway,
    private readonly screenshots: ScreenshotUploadService,
    private readonly manifestDelta: ManifestDeltaService,
    private readonly pairing: PairingService
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'campaign_manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Paginated tablet inventory for operators' })
  listInventory(@Query() query: DeviceListQueryDto, @Req() req: Request) {
    return this.deviceList.findAll(
      query,
      extractFleetAuditFromRequest(req)
    );
  }

  @Post('inventory-register')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Register tablet by serial (Pending inventory). Pair to a vehicle on the pairing flow.',
  })
  async registerInventory(@Body() dto: RegisterInventoryDeviceDto) {
    const res = await this.pairing.registerInventoryDevice(dto);
    this.gateway.requestFleetMapRefresh();
    return res;
  }

  @Delete(':deviceId/bind')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin')
  @ApiBearerAuth()
  async unbind(@Param('deviceId') deviceId: string, @Req() req: Request) {
    const res = await this.unbindService.unbind(
      deviceId,
      extractFleetAuditFromRequest(req)
    );
    this.gateway.requestFleetMapRefresh();
    return res;
  }

  @Patch(':deviceId/state')
  @HttpCode(200)
  @Throttle({
    default: {
      limit: 10,
      ttl: 60_000,
      getTracker: (req: Request, _ctx: ExecutionContext) => {
        const deviceId =
          (req.params as { deviceId?: string } | undefined)?.deviceId ??
          'unknown';
        const uid =
          (req as AuthedRequest).user?.userId ?? req.ip ?? 'unknown';
        return `device-state:${deviceId}:${uid}`;
      },
    },
  })
  @UseGuards(JwtAuthGuard, RetiredDeviceGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Transition device lifecycle state (admin)' })
  @ApiResponse({ status: 200, description: 'Transition applied' })
  @ApiResponse({ status: 400, description: 'INVALID_TRANSITION' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async transitionState(
    @Param('deviceId') deviceId: string,
    @Body() dto: DeviceStateTransitionDto,
    @Req() req: AuthedRequest
  ) {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    const ev = await this.fsm.transitionTo(deviceId, dto.toState, {
      type: 'admin',
      detail: dto.reason,
      actorId: req.user.userId,
    });
    this.gateway.emitDeviceStateChanged({
      type: 'device_state_changed',
      deviceId,
      vehicleId: device.boundVehicleId,
      fromState: ev.fromState,
      toState: ev.toState,
      trigger: { type: 'admin', detail: dto.reason },
      occurredAt: ev.occurredAt,
    });
    this.gateway.requestFleetMapRefresh();
    return {
      deviceId,
      fromState: ev.fromState,
      toState: ev.toState,
      eventId: ev.eventId,
      transitionedAt: ev.occurredAt,
    };
  }

  @Get(':deviceId/session')
  @UseGuards(DeviceJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fleet binding context for this device (device JWT + fingerprint)',
  })
  @ApiResponse({ status: 200, description: 'deviceId and boundVehicleId (null if unbound)' })
  async getDeviceSession(@Param('deviceId') deviceId: string) {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) {
      throw new NotFoundException('Device not found');
    }
    return {
      deviceId: device.deviceId,
      boundVehicleId: device.boundVehicleId,
    };
  }

  @Get(':deviceId/manifest')
  @UseGuards(DeviceJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Manifest delta (device JWT + fingerprint)',
  })
  async getManifestDelta(
    @Param('deviceId') _deviceId: string,
    @Query('sinceVersion') sinceRaw?: string
  ): Promise<ManifestDeltaResponse> {
    let sinceVersion: number | undefined;
    if (sinceRaw !== undefined && sinceRaw !== '') {
      const n = Number(sinceRaw);
      if (!Number.isFinite(n) || n < 0) {
        throw new BadRequestException('sinceVersion must be a non-negative number');
      }
      sinceVersion = n;
    }
    return this.manifestDelta.getDelta(sinceVersion);
  }

  @Get(':deviceId/lifecycle-events')
  @UseGuards(JwtAuthGuard, RetiredDeviceGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List lifecycle transition events for a device' })
  async listLifecycleEvents(
    @Param('deviceId') deviceId: string,
    @Query() query: DeviceLifecycleEventsQueryDto
  ): Promise<DeviceLifecycleEventsResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const { data, total, page: p, limit: l } =
      await this.lifecycleEvents.findByDevice(deviceId, { page, limit });
    return {
      data: data.map((e) => ({
        eventId: e.eventId,
        fromState: e.fromState,
        toState: e.toState,
        trigger: {
          type: e.trigger.type,
          detail: e.trigger.detail,
          actorId: e.trigger.actorId,
        },
        occurredAt: e.occurredAt.toISOString(),
      })),
      pagination: { total, page: p, limit: l },
    };
  }

  @Post(':deviceId/commands/screenshots/:commandId')
  @HttpCode(204)
  @UseGuards(DeviceJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Upload screenshot for GET_SCREENSHOT (base64 body; device JWT + fingerprint)',
  })
  async uploadCommandScreenshot(
    @Param('deviceId') deviceId: string,
    @Param('commandId') _commandId: string,
    @Body() dto: ScreenshotUploadDto
  ): Promise<void> {
    await this.screenshots.save(
      deviceId,
      _commandId,
      Buffer.from(dto.imageBase64, 'base64')
    );
  }

  @Post(':deviceId/watchdog-events')
  @HttpCode(204)
  @UseGuards(DeviceJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Report watchdog transition (003; structured server log)',
  })
  async ingestWatchdogEvent(
    @Param('deviceId') deviceId: string,
    @Body() dto: WatchdogEventDto
  ): Promise<void> {
    this.log.log(
      JSON.stringify({
        event: 'device.watchdog',
        deviceId,
        eventType: dto.eventType,
        occurredAt: dto.occurredAt,
        context: dto.context ?? {},
      })
    );
  }

  @Patch(':deviceId/capability-manifest')
  @UseGuards(DeviceJwtAuthGuard)
  @ApiOperation({ summary: 'Update device capability manifest (device JWT)' })
  async updateCapabilityManifest(
    @Param('deviceId') deviceId: string,
    @Body() dto: CapabilityManifestUpdateDto
  ) {
    if (dto.availableStorageGb > dto.totalStorageGb) {
      throw new BadRequestException(
        'availableStorageGb must not exceed totalStorageGb'
      );
    }
    const now = new Date().toISOString();
    const updated = await this.devices.updateOne(
      { deviceId },
      {
        $set: {
          capabilityManifest: {
            screenWidthPx: dto.screenWidthPx,
            screenHeightPx: dto.screenHeightPx,
            screenSizeInches: dto.screenSizeInches,
            totalStorageGb: dto.totalStorageGb,
            availableStorageGb: dto.availableStorageGb,
            osVersion: dto.osVersion,
            appVersion: dto.appVersion,
            firmwareVersion: dto.firmwareVersion,
            reportedAt: now,
          },
        },
      }
    );
    if (!updated) {
      throw new NotFoundException('Device not found');
    }
    return {
      deviceId,
      manifestUpdatedAt: now,
    };
  }
}
