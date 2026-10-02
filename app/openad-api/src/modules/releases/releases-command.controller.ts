import {
  BadRequestException,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SecurityAuditService } from '../auth/security-audit.service';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { ReleaseAuditService } from './services/release-audit.service';

type JwtUser = { userId: string; email: string; role: string };

@ApiTags('releases')
@Controller('releases')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('super_admin')
@ApiBearerAuth()
export class ReleasesCommandController {
  constructor(
    private readonly mqtt: MqttService,
    private readonly audit: ReleaseAuditService,
    private readonly securityAudit: SecurityAuditService
  ) {}

  @Post('devices/:deviceId/commands/check-app-updates')
  @ApiOperation({ summary: 'MQTT: ask device to run update check now' })
  async checkAppUpdates(
    @Param('deviceId') deviceId: string,
    @Req() req: Request
  ): Promise<{ commandId: string; topic: string }> {
    const u = req.user as JwtUser | undefined;
    if (!u?.userId) {
      throw new BadRequestException('User context required');
    }
    const commandId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60_000);
    const topic = `openad/${deviceId}/commands`;
    const payload = {
      commandId,
      type: 'CHECK_APP_UPDATES' as const,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      payload: null,
    };
    await this.mqtt.publish(topic, JSON.stringify(payload), 1, false);
    await this.audit.record({
      actorUserId: u.userId,
      action: 'release.command_update_check',
      subjectId: deviceId,
      metadata: { commandId },
    });
    await this.securityAudit.record({
      actorUserId: u.userId,
      action: 'release.force_update_check',
      subjectId: deviceId,
      metadata: { commandId, deviceId },
    });
    return { commandId, topic };
  }
}
