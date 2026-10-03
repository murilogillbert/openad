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
 * Analytics de campanha, somente leitura (FR-009–FR-011).
 *
 * O caminho era `analytics/v1/campaigns`, que sob o prefixo global `api/v1` produzia
 * `/api/v1/analytics/v1/campaigns` — a versao duas vezes, uma delas sem significado. A
 * `specs/006` descrevia esse segmento como superficie versionada de forma independente, mas
 * isso nunca se concretizou: nao existe `analytics/v2`, nenhuma outra area da API tem
 * versionamento proprio, e o hub e o opendriver usam um unico prefixo. Manter dois niveis de
 * versao custa confusao em cada rota nova e nao compra nada.
 */
@ApiTags('analytics', 'reporting')
@Controller('analytics/campaigns')
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
