import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SyncWindowsUpdateDto } from './dto/sync-windows-update.dto';
import { DeviceGroupsService } from './device-groups.service';

@ApiTags('admin-device-groups')
@Controller('admin/device-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('fleet_admin', 'super_admin')
@ApiBearerAuth()
export class AdminDeviceGroupsController {
  constructor(private readonly groups: DeviceGroupsService) {}

  @Patch(':groupId/sync-windows')
  @ApiOperation({
    summary: 'Update sync window rules; pushes MQTT config to group devices',
  })
  updateSyncWindows(
    @Param('groupId') groupId: string,
    @Body() dto: SyncWindowsUpdateDto
  ) {
    return this.groups.updateSyncWindows(groupId, dto);
  }
}
