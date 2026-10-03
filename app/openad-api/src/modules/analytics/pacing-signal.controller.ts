import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PacingSignalService } from './services/pacing-signal.service';

@ApiTags('analytics', 'pacing')
@Controller('analytics/campaigns')
export class PacingSignalController {
  constructor(private readonly pacing: PacingSignalService) {}

  @Get(':campaignId/pacing')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('fleet_operator', 'fleet_admin', 'super_admin', 'finance_analyst')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Daily pacing snapshot for a campaign (UTC day)' })
  @ApiResponse({ status: 200, description: 'Pacing snapshot or synthetic zeros when no row yet' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden for role' })
  async getPacing(@Param('campaignId') campaignId: string) {
    const snap = await this.pacing.getSnapshot(campaignId);
    if (!snap) {
      return {
        campaignId,
        dateKey: new Date().toISOString().slice(0, 10),
        billableCostCents: 0,
        budgetCents: 0,
        pacingState: 'normal' as const,
      };
    }
    return snap;
  }
}
