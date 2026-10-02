import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { DashboardSummaryResponse } from '@openad/api-contracts';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
/**
 * Portal aggregate snapshot — same auth as fleet.
 * `dashboard/summary` matches patterns like `fleet/status`; `admin/dashboard/summary` kept as an alias.
 */
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('fleet_admin', 'fleet_operator', 'super_admin')
@ApiBearerAuth()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Aggregated portal dashboard snapshot (fleet, KPIs, pacing, alerts, activity)',
  })
  getSummary(): Promise<DashboardSummaryResponse> {
    return this.dashboard.getSummary();
  }
}
