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
import { PinoLogger } from 'nestjs-pino';
import type { Request } from 'express';
import type {
  FleetStatusResponse,
  IssueCommandResponse,
  RemoteCommandListResponse,
} from '@openad/api-contracts';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FleetQueryService } from './fleet-query.service';
import { RemoteCommandService } from './remote-command.service';
import { IssueCommandDto } from './dto/issue-command.dto';

@Controller('fleet')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FleetMonitorController {
  constructor(
    private readonly logger: PinoLogger,
    private readonly fleetQuery: FleetQueryService,
    private readonly remoteCommands: RemoteCommandService
  ) {
    this.logger.setContext(FleetMonitorController.name);
  }

  @Get('status')
  @Roles('fleet_admin', 'fleet_operator', 'super_admin')
  getStatus(): Promise<FleetStatusResponse> {
    return this.fleetQuery.getStatus();
  }

  @Post('devices/:deviceId/commands')
  @HttpCode(202)
  @Roles('fleet_admin', 'super_admin')
  issueCommand(
    @Param('deviceId') deviceId: string,
    @Body() dto: IssueCommandDto,
    @Req() req: Request
  ): Promise<IssueCommandResponse> {
    const u = req.user as { userId: string } | undefined;
    this.logger.info(
      {
        event: 'fleet.command.issue',
        deviceId,
        type: dto.type,
        operatorUserId: u?.userId ?? null,
      },
      'POST fleet command'
    );
    return this.remoteCommands.issue(
      deviceId,
      { type: dto.type, payload: dto.payload ?? null },
      u?.userId ?? null
    );
  }

  @Get('devices/:deviceId/commands')
  @Roles('fleet_admin', 'super_admin')
  listCommands(
    @Param('deviceId') deviceId: string
  ): Promise<RemoteCommandListResponse> {
    return this.remoteCommands.listForDevice(deviceId);
  }
}
