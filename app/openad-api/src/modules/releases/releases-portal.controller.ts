import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReleasesService } from './services/releases.service';

/**
 * Read-only release information for non-superadmin operators (field / fleet).
 * No artifact tokens or download URLs.
 */
@ApiTags('releases')
@Controller('releases')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ReleasesPortalController {
  constructor(private readonly releases: ReleasesService) {}

  @Get('field-notes')
  @Roles(
    'super_admin',
    'fleet_admin',
    'fleet_operator',
    'campaign_manager',
    'finance_analyst'
  )
  @ApiOperation({
    summary: 'Release notes for operators (read-only; no artifacts)',
  })
  fieldNotes() {
    return this.releases.listFieldReleaseNotes();
  }
}
