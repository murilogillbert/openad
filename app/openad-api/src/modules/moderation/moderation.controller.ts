import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { extractFleetAuditFromRequest } from '../../infrastructure/logging/fleet-audit.context';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ModerationService } from './moderation.service';
import { ModerationDecisionDto } from './dto/moderation-decision.dto';
import { ModerationQueueQueryDto } from './dto/moderation-queue-query.dto';

type PrincipalInterno = { userId?: string; role?: string };

/**
 * Fila e decisao de moderacao de criativo.
 *
 * `@Roles('content_moderator')` cobre o papel dedicado; `super_admin` entra pelo desvio do
 * `RolesGuard`. Gerente de campanha **nao** entra: ele cria campanha, e aprovar a propria
 * campanha anula a revisao. `ModerationService.decidir` repete a verificacao com
 * `canModerate`, porque o guard protege a rota e a politica protege a operacao — se amanha
 * esta decisao for chamada de outro lugar, a regra continua valendo.
 */
@ApiTags('moderation')
@ApiBearerAuth()
@Controller('moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get('queue')
  @Roles('content_moderator')
  @ApiOperation({
    summary: 'Campanhas aguardando revisao, mais antiga primeiro',
  })
  fila(@Query() q: ModerationQueueQueryDto) {
    return this.moderation.fila(q.page ?? 1, q.limit ?? 25);
  }

  @Post('campaigns/:campaignId/decision')
  @Roles('content_moderator')
  @ApiOperation({ summary: 'Aprova ou recusa a campanha, com motivo na recusa' })
  decidir(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: ModerationDecisionDto,
    @Req() req: Request
  ) {
    const u = req.user as PrincipalInterno | undefined;
    return this.moderation.decidir({
      campaignId,
      decisao: dto.decision,
      motivo: dto.reason ?? null,
      ator: { userId: u?.userId ?? null, role: u?.role },
      audit: extractFleetAuditFromRequest(req),
    });
  }
}
