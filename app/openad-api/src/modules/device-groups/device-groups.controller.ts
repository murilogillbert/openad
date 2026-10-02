import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FleetGateway } from '../fleet-monitor/fleet-gateway';
import { CreateDeviceGroupDto } from './dto/create-device-group.dto';
import { PatchGroupMembersDto } from './dto/patch-group-members.dto';
import { UpdateDeviceGroupDto } from './dto/update-device-group.dto';
import { DeviceGroupsService } from './device-groups.service';

class GroupListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;
}

@ApiTags('device-groups')
@Controller('device-groups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('fleet_admin', 'super_admin')
@ApiBearerAuth()
export class DeviceGroupsController {
  constructor(
    private readonly groups: DeviceGroupsService,
    private readonly gateway: FleetGateway
  ) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create device group' })
  create(@Body() dto: CreateDeviceGroupDto) {
    return this.groups.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List device groups' })
  findAll(@Query() query: GroupListQueryDto) {
    return this.groups.findAll(query.page ?? 1, query.limit ?? 50);
  }

  @Get(':groupId')
  @ApiOperation({ summary: 'Get device group' })
  findOne(@Param('groupId') groupId: string) {
    return this.groups.findById(groupId);
  }

  @Patch(':groupId')
  @ApiOperation({ summary: 'Update device group' })
  update(
    @Param('groupId') groupId: string,
    @Body() dto: UpdateDeviceGroupDto
  ) {
    return this.groups.update(groupId, dto);
  }

  @Patch(':groupId/members')
  @ApiOperation({ summary: 'Update group membership' })
  async updateMembers(
    @Param('groupId') groupId: string,
    @Body() dto: PatchGroupMembersDto
  ) {
    const res = await this.groups.updateMembers(groupId, dto.deviceIds);
    if (res.configSyncComplete) {
      this.gateway.emitConfigSyncComplete(res.configSyncComplete);
    }
    return res;
  }

  @Delete(':groupId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete device group' })
  async remove(@Param('groupId') groupId: string): Promise<void> {
    await this.groups.delete(groupId);
  }
}
