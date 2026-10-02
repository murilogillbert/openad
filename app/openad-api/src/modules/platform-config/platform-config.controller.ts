import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Req,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNumber, IsObject } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PlatformConfigService } from './platform-config.service';
import { PlatformConfigRuntimeService } from './platform-config-runtime.service';
import { SecurityAuditService } from '../auth/security-audit.service';

type JwtUser = { userId: string; email: string; role: string };

class PlatformConfigPutDto {
  @IsNumber()
  version!: number;

  @IsObject()
  config!: Record<string, unknown>;
}

class PlatformConfigRestoreDefaultsDto {
  @IsNumber()
  version!: number;
}

@ApiTags('platform-config')
@Controller('platform-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('fleet_admin', 'super_admin')
@ApiBearerAuth()
export class PlatformConfigController {
  constructor(
    private readonly svc: PlatformConfigService,
    private readonly runtime: PlatformConfigRuntimeService,
    private readonly audit: SecurityAuditService
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Get fleet-wide platform configuration (v1)' })
  async get() {
    const doc = await this.svc.getOrCreateDefaults();
    return {
      active: doc.config,
      defaults: this.svc.defaults(),
      version: doc.version,
    };
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({ summary: 'Save fleet-wide platform configuration' })
  async put(@Body() body: PlatformConfigPutDto, @Body() _raw: unknown, @Req() req: Request) {
    try {
      const doc = await this.svc.save({ version: body.version, config: body.config });
      await this.runtime.refresh();
      const u = req.user as JwtUser | undefined;
      if (u?.userId) {
        await this.audit.record({
          actorUserId: u.userId,
          action: 'platform_config.save',
          subjectId: 'fleet',
          metadata: { version: doc.version },
        });
      }
      return {
        active: doc.config,
        defaults: this.svc.defaults(),
        version: doc.version,
      };
    } catch (e) {
      if (e instanceof Error && e.message === 'VERSION_MISMATCH') {
        throw new ConflictException('VERSION_MISMATCH');
      }
      throw e;
    }
  }

  @Put('restore-defaults')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore fleet-wide platform configuration defaults' })
  async restore(@Body() body: PlatformConfigRestoreDefaultsDto, @Req() req: Request) {
    try {
      const doc = await this.svc.restoreDefaults({ version: body.version });
      await this.runtime.refresh();
      const u = req.user as JwtUser | undefined;
      if (u?.userId) {
        await this.audit.record({
          actorUserId: u.userId,
          action: 'platform_config.restore_defaults',
          subjectId: 'fleet',
          metadata: { version: doc.version },
        });
      }
      return {
        active: doc.config,
        defaults: this.svc.defaults(),
        version: doc.version,
      };
    } catch (e) {
      if (e instanceof Error && e.message === 'VERSION_MISMATCH') {
        throw new ConflictException('VERSION_MISMATCH');
      }
      throw e;
    }
  }
}

