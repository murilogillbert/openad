import { Controller, Get, HttpCode, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DevicesRepository } from './devices.repository';

@ApiTags('admin', 'devices')
@Controller('admin/devices')
export class AdminDevicesController {
  constructor(private readonly devices: DevicesRepository) {}

  @Get('search')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search devices by id/serial (operator tooling)' })
  async search(@Query('q') q: string) {
    const items = await this.devices.searchByDeviceIdOrSerial({
      query: q ?? '',
      limit: 20,
    });
    return items.map((d) => ({
      deviceId: d.deviceId,
      serialNumber: d.serialNumber,
      boundVehicleId: (d as any).boundVehicleId ?? null,
    }));
  }
}

