import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  IssueCommandResponse,
  RemoteCommandListResponse,
} from '@openad/api-contracts';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IssueCommandDto } from './dto/issue-command.dto';
import { RemoteCommandService } from './remote-command.service';

/** Spec 003: admin remote command dispatch + history (`contracts/rest-api.md`). */
@ApiTags('admin', 'devices', 'commands')
@Controller('admin/devices')
export class AdminDevicesCommandsController {
  constructor(private readonly remoteCommands: RemoteCommandService) {}

  @Post(':deviceId/commands')
  @HttpCode(202)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Dispatch remote command to a device (003)' })
  async issue(
    @Param('deviceId') deviceId: string,
    @Body() dto: IssueCommandDto,
    @Req() req: Request
  ): Promise<IssueCommandResponse> {
    const u = req.user as { userId: string } | undefined;
    return this.remoteCommands.issue(
      deviceId,
      { type: dto.type, payload: dto.payload ?? null },
      u?.userId ?? null
    );
  }

  @Get(':deviceId/commands')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_admin', 'super_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List recent remote commands for a device' })
  list(
    @Param('deviceId') deviceId: string
  ): Promise<RemoteCommandListResponse> {
    return this.remoteCommands.listForDevice(deviceId);
  }
}
