import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractFleetAuditFromRequest } from '../../infrastructure/logging/fleet-audit.context';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { PairVehicleDto } from './dto/pair-vehicle.dto';
import { UnpairVehicleDto } from './dto/unpair-vehicle.dto';
import { VehicleBindingAuditQueryDto } from './dto/vehicle-binding-audit-query.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleListQueryDto } from './dto/vehicle-list-query.dto';
import { VehicleBindingAuditQueryService } from './vehicle-binding-audit-query.service';
import { VehicleBindingService } from './vehicle-binding.service';
import { VehiclesQueryService } from './vehicles-query.service';
import { VehiclesUpdateService } from './vehicles-update.service';
import { VehicleDecommissionService } from './vehicle-decommission.service';
import { VehiclesCreateService } from './vehicles-create.service';

@Controller('vehicles')
export class VehiclesController {
  constructor(
    private readonly query: VehiclesQueryService,
    private readonly updates: VehiclesUpdateService,
    private readonly decommission: VehicleDecommissionService,
    private readonly binding: VehicleBindingService,
    private readonly bindingAuditQuery: VehicleBindingAuditQueryService,
    private readonly createSvc: VehiclesCreateService
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'campaign_manager')
  list(@Query() query: VehicleListQueryDto, @Req() req: Request) {
    return this.query.findAll(query, extractFleetAuditFromRequest(req));
  }

  @Post()
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin')
  create(
    @Body() dto: CreateVehicleDto,
    @Req() req: Request & { user?: { userId: string } }
  ) {
    const operatorId = req.user?.userId ?? 'unknown';
    return this.createSvc.create(
      dto,
      extractFleetAuditFromRequest(req),
      operatorId
    );
  }

  @Get(':vehicleId/binding-audit')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'campaign_manager')
  bindingAudit(
    @Param('vehicleId') vehicleId: string,
    @Query() query: VehicleBindingAuditQueryDto
  ) {
    return this.bindingAuditQuery.listForVehicle(vehicleId, {
      limit: query.limit,
      cursor: query.cursor,
      deviceId: query.deviceId,
    });
  }

  @Post(':vehicleId/pair')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin')
  pair(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: PairVehicleDto,
    @Req() req: Request
  ) {
    return this.binding.pair(
      vehicleId,
      dto.deviceId,
      extractFleetAuditFromRequest(req)
    );
  }

  @Post(':vehicleId/unpair')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin')
  unpair(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: UnpairVehicleDto,
    @Req() req: Request
  ) {
    return this.binding.unpair(
      vehicleId,
      dto.deviceId,
      extractFleetAuditFromRequest(req)
    );
  }

  @Get(':vehicleId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'campaign_manager')
  async getOne(@Param('vehicleId') vehicleId: string, @Req() req: Request) {
    const v = await this.query.findOne(
      vehicleId,
      extractFleetAuditFromRequest(req)
    );
    if (!v) {
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', vehicleId });
    }
    return v;
  }

  @Patch(':vehicleId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'campaign_manager')
  patch(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: UpdateVehicleDto,
    @Req() req: Request
  ) {
    return this.updates.update(
      vehicleId,
      dto,
      extractFleetAuditFromRequest(req)
    );
  }

  @Delete(':vehicleId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin')
  remove(@Param('vehicleId') vehicleId: string, @Req() req: Request) {
    return this.decommission.decommission(
      vehicleId,
      extractFleetAuditFromRequest(req)
    );
  }
}
