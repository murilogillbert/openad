import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SpatialLedgerIngestService } from './spatial-ledger-ingest.service';
import { SpatialLedgerQueryService } from './spatial-ledger-query.service';

@Controller('spatial-ledger')
export class SpatialLedgerController {
  constructor(
    private readonly ledgerIngest: SpatialLedgerIngestService,
    private readonly query: SpatialLedgerQueryService
  ) {}

  @Post('ingest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  ingest(@Body() body: unknown) {
    return this.ledgerIngest.ingestBatch(body, null);
  }

  @Get('receipts')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('campaign_manager', 'fleet_admin', 'super_admin')
  findReceipts(
    @Query('deviceId') deviceId?: string,
    @Query('zoneId') zoneId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.query.findReceipts({
      deviceId,
      zoneId,
      fromStartedAt: from,
      toStartedAt: to,
    });
  }
}
