import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportingAggregationService } from './services/reporting-aggregation.service';

/**
 * Read-only campaign analytics (FR-009–FR-011). Versioned under `analytics/v1/…`.
 */
@ApiTags('analytics', 'reporting')
@Controller('analytics/v1/campaigns')
export class AnalyticsReportingController {
  constructor(private readonly reporting: ReportingAggregationService) {}

  @Get(':campaignId/reporting/summary')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'super_admin', 'finance_analyst')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Campaign impressions, reach, and revenue for a time window' })
  @ApiResponse({ status: 200, description: 'Summary aggregates for the window' })
  @ApiResponse({ status: 400, description: 'Invalid or missing date query params' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden for role' })
  async getCampaignSummary(
    @Param('campaignId') campaignId: string,
    @Query('from') fromRaw: string,
    @Query('to') toRaw: string
  ) {
    const from = parseIsoDate(fromRaw, 'from');
    const to = parseIsoDate(toRaw, 'to');
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('from must be before to');
    }
    return this.reporting.summarizeCampaign(campaignId, from, to);
  }
}

function parseIsoDate(raw: string | undefined, name: string): Date {
  if (!raw?.trim()) {
    throw new BadRequestException(`Query ${name} is required (ISO-8601)`);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Query ${name} must be a valid ISO date`);
  }
  return d;
}
