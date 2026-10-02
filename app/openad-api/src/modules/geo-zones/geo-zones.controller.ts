import {
  Body,
  Controller,
  Get,
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
import { CreateGeoZoneDto } from './dto/create-geo-zone.dto';
import { ListGeoZonesQueryDto } from './dto/list-geo-zones-query.dto';
import { UpdateGeoZoneDto } from './dto/update-geo-zone.dto';
import { GeoZoneService } from './geo-zone.service';

type JwtUser = { userId: string };

@Controller('geo-zones')
export class GeoZonesController {
  constructor(private readonly zones: GeoZoneService) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  create(@Body() dto: CreateGeoZoneDto, @Req() req: Request) {
    const u = req.user as JwtUser | undefined;
    return this.zones.create(
      dto,
      extractFleetAuditFromRequest(req),
      u?.userId ?? null
    );
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'fleet_operator', 'super_admin')
  list(@Query() query: ListGeoZonesQueryDto) {
    return this.zones.findAll(query);
  }

  @Patch(':zoneId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  patch(
    @Param('zoneId') zoneId: string,
    @Body() dto: UpdateGeoZoneDto,
    @Req() req: Request
  ) {
    return this.zones.update(
      zoneId,
      dto,
      extractFleetAuditFromRequest(req)
    );
  }
}
