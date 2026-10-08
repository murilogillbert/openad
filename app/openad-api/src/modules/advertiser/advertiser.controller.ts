import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReportingAggregationService } from '../analytics/services/reporting-aggregation.service';
import { MediaIngestionService } from '../media-ingestion/media-ingestion.service';
import { MediaFolderProvisioningService } from '../media-ingestion/media-folder-provisioning.service';
import { UploadSessionService } from '../media-ingestion/upload-session.service';
import { CreditPurchaseService } from '../monetization/credit-purchase.service';
import {
  ComprarCreditoPixDto,
  ExtratoQueryDto,
} from '../monetization/dto/credit.dto';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';
import { AdvertiserCampaignsService } from './advertiser-campaigns.service';
import { AdvertiserInventoryService } from './advertiser-inventory.service';
import { anuncianteDaRequisicao } from './advertiser-principal';
import { CreateAdvertiserCampaignDto } from './dto/create-advertiser-campaign.dto';
import { AdvertiserListQueryDto } from './dto/advertiser-list-query.dto';
import { InventoryZonesQueryDto } from './dto/inventory-zones-query.dto';
import { StartCreativeUploadDto } from './dto/start-creative-upload.dto';

/**
 * Superficie do app do anunciante.
 *
 * Prefixo proprio, separado do portal interno, por tres razoes concretas: o papel que entra
 * aqui vem de outra origem de token (`jwt-federated`), toda consulta e escopada por dono, e a
 * projecao de resposta omite campo operacional que o portal mostra. Misturar com
 * `/campaigns` significaria uma rota com dois comportamentos de autorizacao decidindo por
 * `if`, que e exatamente a forma de vazar dado entre parceiros sem erro aparecer.
 *
 * `@Roles('advertiser')` nao basta sozinho: o `RolesGuard` tem desvio incondicional para
 * `super_admin`. Cada handler chama `anuncianteDaRequisicao`, que recusa qualquer principal
 * sem `advertiserId` — ver a nota naquele arquivo.
 */
@ApiTags('advertiser')
@ApiBearerAuth()
@Controller('advertiser')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('advertiser')
export class AdvertiserController {
  constructor(
    private readonly campanhas: AdvertiserCampaignsService,
    private readonly inventario: AdvertiserInventoryService,
    private readonly relatorios: ReportingAggregationService,
    private readonly uploadSessions: UploadSessionService,
    private readonly mediaIngestion: MediaIngestionService,
    private readonly folders: MediaFolderProvisioningService,
    private readonly credito: CreditPurchaseService,
    private readonly platform: PlatformConfigRuntimeService
  ) {}

  @Post('campaigns')
  @HttpCode(201)
  @ApiOperation({ summary: 'Cria campanha em rascunho, com dono e repasse validados' })
  async criarCampanha(
    @Body() dto: CreateAdvertiserCampaignDto,
    @Req() req: Request
  ) {
    return this.campanhas.criar(dto, anuncianteDaRequisicao(req));
  }

  @Get('campaigns')
  @ApiOperation({ summary: 'Lista as campanhas do proprio anunciante' })
  async listarCampanhas(
    @Query() q: AdvertiserListQueryDto,
    @Req() req: Request
  ) {
    return this.campanhas.listar(
      anuncianteDaRequisicao(req),
      q.page ?? 1,
      q.limit ?? 20
    );
  }

  @Get('campaigns/:campaignId')
  @ApiOperation({ summary: 'Detalhe de uma campanha do proprio anunciante' })
  async obterCampanha(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() req: Request
  ) {
    return this.campanhas.obter(campaignId, anuncianteDaRequisicao(req));
  }

  @Post('campaigns/:campaignId/submit')
  @ApiOperation({ summary: 'Envia a campanha para moderacao humana' })
  async submeterCampanha(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() req: Request
  ) {
    return this.campanhas.submeter(campaignId, anuncianteDaRequisicao(req));
  }

  /**
   * Abre sessao de upload de criativo, **na pasta da campanha**.
   *
   * O cliente informa apenas nome e tipo do arquivo. `folderId` e `campaignId` da sessao sao
   * resolvidos pelo servidor a partir da campanha que ele acabou de confirmar ser do
   * solicitante — se viessem do corpo, um anunciante poderia depositar criativo na pasta de
   * outro, e o ativo apareceria no explorador de midia do parceiro errado.
   */
  @Post('campaigns/:campaignId/media')
  @HttpCode(201)
  @Throttle({ mediaUpload: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Abre sessao de upload de criativo da campanha' })
  async iniciarUploadDeCriativo(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Body() dto: StartCreativeUploadDto,
    @Req() req: Request
  ) {
    const anunciante = anuncianteDaRequisicao(req);
    const campanha = await this.campanhas.obterOuFalhar(campaignId, anunciante);

    const folderId = await this.folders.ensureCampaignFolderId(
      campaignId,
      campanha.name
    );
    if (!folderId) {
      throw new BadRequestException({
        error: {
          code: 'VFS_NOT_BOOTSTRAPPED',
          message:
            'A arvore de midia nao esta inicializada no servidor; nao ha pasta de campanha para receber o criativo',
        },
      });
    }

    const data = await this.uploadSessions.createSession(
      {
        filename: dto.filename,
        contentType: dto.contentType,
        folderId,
        campaignId,
        campaignIds: [campaignId],
      },
      anunciante.userId
    );
    return { success: true, data };
  }

  /**
   * Recebe os bytes do criativo pela API.
   *
   * A sessao e amarrada ao `initiatedBy`, e `receiveProxiedUpload` recusa sessao de outro
   * usuario com 403 — de modo que um anunciante nao consegue enviar bytes para a sessao de
   * outro mesmo conhecendo o `sessionId`. O limite de 500 MB e o mesmo do fluxo interno,
   * porque o teto real quem define e `platform_config.mediaLimits.maxVideoBytes`, verificado
   * na sessao.
   */
  @Post('campaigns/:campaignId/media/:sessionId/bytes')
  @HttpCode(204)
  @Throttle({ mediaUpload: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Envia os bytes do criativo (campo multipart: file)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 524_288_000 },
    })
  )
  async enviarBytesDoCriativo(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: Request
  ): Promise<void> {
    const anunciante = anuncianteDaRequisicao(req);
    await this.campanhas.obterOuFalhar(campaignId, anunciante);
    if (!file?.buffer) {
      throw new BadRequestException({
        error: {
          code: 'FILE_REQUIRED',
          message: 'Falta o campo multipart "file"',
        },
      });
    }
    await this.uploadSessions.receiveProxiedUpload(
      sessionId,
      anunciante.userId,
      file
    );
  }

  /**
   * Fecha a sessao: valida tecnicamente o arquivo (ffprobe contra o ruleset DOOH), registra
   * no catalogo com `ownerUserId` e marca a sessao como concluida.
   *
   * O `ownerUserId` explicito e o que separa o criativo deste parceiro do dos outros, e
   * tambem o que escopa a deduplicacao por hash — sem ele, dois anunciantes com o mesmo
   * arquivo receberiam o mesmo `mediaId`, e o segundo nao veria o proprio ativo.
   */
  @Post('campaigns/:campaignId/media/:sessionId/complete')
  @Throttle({ mediaUpload: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Valida e registra o criativo no catalogo' })
  async concluirUploadDeCriativo(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Req() req: Request
  ) {
    const anunciante = anuncianteDaRequisicao(req);
    await this.campanhas.obterOuFalhar(campaignId, anunciante);
    const data = await this.mediaIngestion.completeVfsUpload(
      sessionId,
      anunciante.userId,
      anunciante.userId
    );
    return { success: true, data };
  }

  @Get('campaigns/:campaignId/estimate')
  @ApiOperation({ summary: 'Alcance e custo previstos, contados do banco' })
  async estimar(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Req() req: Request
  ) {
    const campanha = await this.campanhas.obterOuFalhar(
      campaignId,
      anuncianteDaRequisicao(req)
    );
    return this.inventario.estimar(campanha);
  }

  /**
   * Proof-of-play do dono.
   *
   * Usa o mesmo agregador do portal, sobre `play_records` ja reconciliados e com antifraude
   * aplicada — nao sobre o que o tablete reportou. A janela padrao e a contratada, porque e
   * o periodo que o anunciante pagou; `from`/`to` permitem recortar.
   */
  @Get('campaigns/:campaignId/report')
  @Throttle({ reports: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Proof-of-play da campanha do proprio anunciante' })
  async relatorio(
    @Param('campaignId', ParseUUIDPipe) campaignId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: Request
  ) {
    const campanha = await this.campanhas.obterOuFalhar(
      campaignId,
      anuncianteDaRequisicao(req)
    );
    const inicio = from ? new Date(from) : campanha.scheduledStart;
    const fim = to ? new Date(to) : new Date();
    if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) {
      throw new BadRequestException({
        error: {
          code: 'BAD_QUERY',
          message: 'from e to, quando informados, precisam ser datas ISO',
        },
      });
    }
    return this.relatorios.summarizeCampaign(campaignId, inicio, fim);
  }

  @Get('inventory/zones')
  @ApiOperation({ summary: 'Zonas e tiers disponiveis para segmentacao' })
  async zonas(@Query() q: InventoryZonesQueryDto, @Req() req: Request) {
    anuncianteDaRequisicao(req);
    const data = await this.inventario.listarZonas({
      city: q.city,
      tier: q.tier,
    });
    return { data };
  }

  // ------------------------------------------------------------------ credito de veiculacao
  //
  // A compra e por **Pix, num painel web** (decisao de 2026-10-07). O app do anunciante fica so
  // de gestao: a compra dentro do app exigiria in-app purchase pela politica do Google, com
  // taxa de 15 a 30% — numa operacao cujo preco unitario e R$ 0,045 por exibicao, isso sai do
  // que sobra para a plataforma e para o motorista.
  //
  // Estas rotas sao somente de leitura e de criacao de cobranca. Confirmacao e estorno chegam
  // por `/internal/*`, autenticadas por chave de servico, porque quem as dispara e o hub depois
  // de reconsultar o status no Asaas — nunca o cliente.

  @Get('credits/balance')
  @ApiOperation({ summary: 'Saldo de credito: total, retido e disponivel' })
  async saldo(@Req() req: Request) {
    const anunciante = anuncianteDaRequisicao(req);
    const data = await this.credito.saldo(anunciante.advertiserId);
    return { data };
  }

  @Get('credits/ledger')
  @ApiOperation({ summary: 'Extrato do credito, do gasto mais recente para tras' })
  async extrato(@Query() q: ExtratoQueryDto, @Req() req: Request) {
    const anunciante = anuncianteDaRequisicao(req);
    const data = await this.credito.extrato(
      anunciante.advertiserId,
      q.page ?? 1,
      q.limit ?? 50
    );
    return { data };
  }

  @Get('credits/purchases')
  @ApiOperation({ summary: 'Compras de credito do proprio anunciante' })
  async compras(@Query() q: ExtratoQueryDto, @Req() req: Request) {
    const anunciante = anuncianteDaRequisicao(req);
    const data = await this.credito.compras(
      anunciante.advertiserId,
      q.page ?? 1,
      q.limit ?? 20
    );
    return { data };
  }

  @Get('credits/pricing')
  @ApiOperation({ summary: 'Tabela de preco por duracao e limites de compra' })
  async tabelaDePrecos(@Req() req: Request) {
    anuncianteDaRequisicao(req);
    const data = this.credito.tabela(
      this.platform.get().monetization.pricePerSecondMicros
    );
    return { data };
  }

  /**
   * Abre uma cobranca Pix para comprar credito.
   *
   * Limitada no tempo porque cada chamada pode criar uma cobranca no provedor. O servico ainda
   * reaproveita cobranca pendente nao vencida do mesmo valor — sem isso, recarregar a pagina de
   * pagamento geraria uma segunda cobranca para o mesmo pedido e o anunciante poderia pagar as
   * duas.
   */
  @Post('credits/pix')
  @HttpCode(201)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Gera cobranca Pix para comprar credito de veiculacao' })
  async comprarComPix(@Body() dto: ComprarCreditoPixDto, @Req() req: Request) {
    const anunciante = anuncianteDaRequisicao(req);
    const data = await this.credito.comprarComPix({
      advertiserId: anunciante.advertiserId,
      advertiserUserId: anunciante.userId,
      amountCents: dto.amountCents,
    });
    return { data };
  }
}
