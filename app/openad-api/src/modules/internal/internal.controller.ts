import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CreditPurchaseService } from '../monetization/credit-purchase.service';
import {
  AjustarCreditoDto,
  ConfirmarCreditoDto,
  EstornarCreditoDto,
} from '../monetization/dto/credit.dto';
import { AccountPurgeService } from './account-purge.service';
import { AdPayoutsReportService } from './ad-payouts-report.service';
import {
  EscoposDeChave,
  ServiceApiKeyGuard,
  type PrincipalDeServico,
} from './service-api-key.guard';
import { PayoutsQueryDto } from './dto/payouts-query.dto';
import { DriverPlaysQueryDto } from './dto/driver-plays-query.dto';

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
    private readonly payouts: AdPayoutsReportService,
    private readonly credito: CreditPurchaseService
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

  /**
   * Anúncios exibidos nos veículos de um motorista numa janela de tempo.
   *
   * É o que permite ao opendriver somar a receita de anúncio **à corrida** na tela de
   * Ganhos: ele conhece o início e o fim do trajeto, passa o intervalo, e recebe quantos
   * anúncios tocaram e quanto rendem. O openad não tem conceito de corrida, então a janela
   * é o único recorte que ele sabe fazer.
   *
   * Rota de leitura, sem efeito nenhum. O crédito continua saindo no instante em que a
   * veiculação vira faturável; aqui é só o detalhamento que a tela precisa mostrar.
   *
   * Reusa o escopo `ads:payout:read` em vez de criar um novo: é o mesmo dado (repasse do
   * motorista) com outro recorte, e um escopo novo exigiria reemitir chave no hub — um
   * serviço que hoje consulta o total passaria a receber 403 ao pedir o detalhe.
   */
  @Get('ads/driver-plays')
  @EscoposDeChave('ads:payout:read')
  @ApiOperation({
    summary: 'Anuncios exibidos para um motorista numa janela (soma a corrida)',
  })
  async driverPlays(@Query() q: DriverPlaysQueryDto) {
    return this.payouts.veiculacoesDoMotorista(
      q.driverUserId,
      new Date(q.from),
      new Date(q.to)
    );
  }

  // ------------------------------------------------------------------ credito de veiculacao
  //
  // Confirmacao e estorno chegam **por aqui**, e nao por rota de anunciante, porque quem as
  // dispara e o hub depois de reconsultar o status no Asaas. O corpo do webhook do provedor
  // nunca e tratado como verdade: se fosse, bastaria a alguem forjar um POST para creditar
  // saldo. A chave de servico com escopo e o que separa "o hub confirmou" de "alguem disse que
  // pagou".

  /**
   * Confirma o pagamento de uma compra e credita o saldo. **Idempotente.**
   *
   * Responde `200` mesmo quando a compra ja estava confirmada, com `jaConfirmada: true`. Nao e
   * tolerancia a erro: o provedor reenvia evento, e devolver `409` faria o hub registrar falha
   * e tentar de novo para sempre num caso que esta, de fato, resolvido.
   */
  @Post('ads/credits/:purchaseId/confirm')
  @EscoposDeChave('ads:credit:write')
  @ApiOperation({ summary: 'Confirma pagamento de credito e lanca no ledger' })
  async confirmarCredito(
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @Body() dto: ConfirmarCreditoDto
  ) {
    const data = await this.credito.confirmarPagamento({
      purchaseId,
      externalId: dto.externalId ?? null,
    });
    return { data };
  }

  /**
   * Estorna uma compra: lancamento compensatorio, nao apagamento.
   *
   * O saldo pode ficar negativo, e e o resultado correto quando o credito devolvido ja tinha
   * sido gasto — negativo impede nova reserva e fica visivel para cobranca, o que e melhor do
   * que zerar e perder a informacao.
   */
  @Post('ads/credits/:purchaseId/refund')
  @EscoposDeChave('ads:credit:write')
  @ApiOperation({ summary: 'Estorna compra de credito com lancamento compensatorio' })
  async estornarCredito(
    @Param('purchaseId', ParseUUIDPipe) purchaseId: string,
    @Body() dto: EstornarCreditoDto
  ) {
    const data = await this.credito.estornar({
      purchaseId,
      motivo: dto.motivo,
    });
    return { data };
  }

  /**
   * Lancamento manual de credito.
   *
   * E o caminho que destrava a veiculacao enquanto o Asaas nao esta configurado: o anunciante
   * paga por fora, o operador confere no extrato e lanca aqui. Sem ele, nenhuma campanha
   * veicularia ate a credencial existir, porque a reserva por ciclo nao teria o que reservar.
   *
   * O `actorId` registrado na trilha e a **chave de servico** que chamou, nao um usuario: nao
   * ha pessoa autenticada nesta superficie, e inventar um id de usuario aqui tornaria a
   * auditoria menos confiavel do que ela e.
   */
  @Post('ads/credits/adjust')
  @EscoposDeChave('ads:credit:write')
  @ApiOperation({ summary: 'Lanca credito ou debito manual no saldo do anunciante' })
  async ajustarCredito(@Body() dto: AjustarCreditoDto, @Req() req: Request) {
    const servico = (req as Request & { servico?: PrincipalDeServico }).servico;
    const data = await this.credito.ajustar({
      advertiserId: dto.advertiserId,
      amountCents: dto.amountCents,
      direction: dto.direction,
      referenceId: dto.referenceId,
      actorId: null,
      motivo: `${dto.motivo} [chave: ${servico?.label ?? 'desconhecida'}]`,
    });
    return { data };
  }
}
