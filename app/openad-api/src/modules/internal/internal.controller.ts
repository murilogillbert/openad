import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AccountPurgeService } from './account-purge.service';
import { AdPayoutsReportService } from './ad-payouts-report.service';
import { EscoposDeChave, ServiceApiKeyGuard } from './service-api-key.guard';
import { PayoutsQueryDto } from './dto/payouts-query.dto';

/**
 * Superfície servico-a-servico (`/api/v1/internal/*`).
 *
 * Autenticada por `public.service_api_keys`, **não** por JWT: quem chama é outro serviço do
 * ecossistema, não uma pessoa. Daí o guard próprio em vez do `JwtAuthGuard`.
 *
 * `@SkipThrottle()` porque o limitador global conta por IP, e todas as chamadas do hub
 * chegam do mesmo IP interno. Com o teto normal, um fan-out de exclusão em lote seria
 * barrado como se fosse abuso — e o controle de acesso aqui é a chave com escopo, que é mais
 * forte que contagem por IP.
 */
@ApiTags('internal')
@ApiBearerAuth()
@Controller('internal')
@UseGuards(ServiceApiKeyGuard)
@SkipThrottle()
export class InternalController {
  constructor(
    private readonly contas: AccountPurgeService,
    private readonly payouts: AdPayoutsReportService
  ) {}

  /**
   * O contrato de resposta é `{ data: { blockers } }`, com envelope.
   *
   * Não é escolha de estilo: o `accountSync.ts` do hub desembrulha `json.data` quando existe
   * e é esse formato que o opendriver já devolve. Responder o objeto cru faria o hub ler
   * `blockers` como `undefined` e concluir que **nada** impede a exclusão — falha silenciosa
   * e na direção perigosa.
   */
  @Get('accounts/:userId/deletion-blockers')
  @EscoposDeChave('account:read')
  @ApiOperation({ summary: 'O que impede excluir esta conta no openad' })
  async deletionBlockers(
    @Param('userId', ParseUUIDPipe) userId: string
  ): Promise<{ data: { blockers: string[] } }> {
    const blockers = await this.contas.blockers(userId);
    return { data: { blockers } };
  }

  /** `204` sem corpo, idempotente — igual ao do opendriver. */
  @Post('accounts/:userId/purge')
  @HttpCode(204)
  @EscoposDeChave('account:purge')
  @ApiOperation({ summary: 'Anonimiza o anunciante e arquiva campanha e criativo' })
  async purge(@Param('userId', ParseUUIDPipe) userId: string): Promise<void> {
    await this.contas.purge(userId);
  }

  /**
   * Repasse devido aos motoristas num período, para o hub conferir.
   *
   * O openad **não** credita o motorista por esta rota: o crédito acontece no momento em que
   * a veiculação vira faturável, em `opendriver.driver_earnings`, por chamada direta. Esta
   * rota é prestação de contas — permite ao hub (e a uma auditoria) somar de forma
   * independente o que o openad diz que gerou, e comparar com o que o livro-caixa do
   * opendriver registrou. Dois números que deveriam bater, calculados por caminhos
   * diferentes.
   */
  @Get('ads/payouts')
  @EscoposDeChave('ads:payout:read')
  @ApiOperation({ summary: 'Repasse por motorista no periodo (conferencia)' })
  async adPayouts(@Query() q: PayoutsQueryDto) {
    return this.payouts.porMotorista(new Date(q.from), new Date(q.to));
  }
}
