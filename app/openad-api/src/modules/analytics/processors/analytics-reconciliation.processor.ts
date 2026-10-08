import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Job } from 'bullmq';
import { Model } from 'mongoose';
import type { PlayRecordPayload } from '@openad/api-contracts';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';
import { ANALYTICS_RECONCILIATION_QUEUE } from '../constants/analytics-queue.constants';
import { PlayRecord } from '../schemas/play-record.schema';
import { FraudDetectionService } from '../services/fraud-detection.service';
import { PacingSignalService } from '../services/pacing-signal.service';
import { ReconciliationService } from '../services/reconciliation.service';
import { DriverEarningClient } from '../../internal/driver-earning.client';
import { repasseEmCentavos } from '../../internal/driver-payout.policy';
import {
  custoEmMicros,
  MICROS_POR_CENTAVO,
  segundosCobrados,
  tipoDoCriativo,
} from '../../monetization/pricing.policy';
import { MediaAsset } from '../../media-ingestion/schemas/media-asset.schema';
import { Vehicle, VehicleDocument } from '../../vehicles/vehicles.schema';

export interface PlayBatchJobData {
  deviceId: string;
  batchId: string;
  plays: PlayRecordPayload[];
}

@Processor(ANALYTICS_RECONCILIATION_QUEUE)
export class AnalyticsReconciliationProcessor extends WorkerHost {
  private readonly log = new Logger(AnalyticsReconciliationProcessor.name);

  constructor(
    @InjectModel(PlayRecord.name)
    private readonly playRecords: Model<PlayRecord>,
    @InjectModel(Vehicle.name)
    private readonly vehicles: Model<VehicleDocument>,
    // O criativo diz se a veiculação é imagem (cobra os segundos da configuração) ou vídeo
    // (cobra a própria duração).
    @InjectModel(MediaAsset.name)
    private readonly mediaAssets: Model<MediaAsset>,
    private readonly reconciliation: ReconciliationService,
    private readonly fraud: FraudDetectionService,
    private readonly pacing: PacingSignalService,
    private readonly campaigns: CampaignsRepository,
    private readonly platform: PlatformConfigRuntimeService,
    private readonly repasses: DriverEarningClient
  ) {
    super();
  }

  /**
   * Credita o repasse do motorista por uma veiculação que acabou de virar faturável.
   *
   * Tudo aqui é best-effort por desenho — ver a nota em `DriverEarningClient.creditar`. O
   * lote de analytics não pode falhar por causa do repasse: reprocessá-lo recontaria o
   * pacing das veiculações já contadas, trocando um crédito perdido (recuperável pela
   * conferência em `/internal/ads/payouts`) por faturamento duplicado (não recuperável).
   */
  private async creditarRepasse(
    play: { campaignId: string; vehicleId: string; uniqueEventId: string },
    valorFaturavelCents: number
  ): Promise<void> {
    if (valorFaturavelCents <= 0 || !this.repasses.habilitado()) {
      return;
    }
    try {
      const veiculo = await this.vehicles
        .findOne({ vehicleId: play.vehicleId })
        .select({ driverId: 1 })
        .lean()
        .exec();
      if (!veiculo?.driverId) {
        // Veículo sem motorista vinculado: a receita existiu, mas não há a quem pagar. O
        // relatório de conferência expõe isso como `unattributedPlays`.
        return;
      }

      const campanha = await this.campaigns.findByCampaignId(play.campaignId);
      const monetizacao = this.platform.get().monetization;
      const amountCents = repasseEmCentavos({
        valorFaturavelCents,
        repasse: campanha?.driverPayout ?? null,
        piso: monetizacao.driverPayoutMinPercent,
        // Rede de segurança: campanha gravada antes do teto existir pode ter `percent` em
        // qualquer valor até 100%, e a validação de criação não reescreve o que já está lá.
        teto: monetizacao.driverPayoutMaxPercent,
      });
      if (amountCents <= 0) {
        return;
      }

      await this.repasses.creditar({
        driverUserId: veiculo.driverId,
        amountCents,
        // A trava de idempotência do opendriver. `uniqueEventId` é único por dispositivo e
        // por veiculação, então o mesmo play record reprocessado não paga duas vezes.
        referenceId: `${play.campaignId}:${play.uniqueEventId}`,
        campaignId: play.campaignId,
        description: 'Repasse por veiculacao de anuncio',
      });
    } catch (e: unknown) {
      this.log.warn(
        JSON.stringify({
          event: 'analytics.repasse.falhou',
          uniqueEventId: play.uniqueEventId,
          err: e instanceof Error ? e.message : String(e),
        })
      );
    }
  }

  async process(job: Job<PlayBatchJobData>): Promise<void> {
    if (!this.platform.get().analytics.enabled) {
      this.log.warn('analytics disabled; skipping reconciliation job');
      return;
    }
    const { deviceId, batchId, plays } = job.data;
    const ingestedAt = new Date();
    for (const p of plays) {
      try {
        await this.playRecords.updateOne(
          { deviceId, uniqueEventId: p.uniqueEventId },
          {
            $setOnInsert: {
              uniqueEventId: p.uniqueEventId,
              deviceId: p.deviceId,
              vehicleId: p.vehicleId,
              campaignId: p.campaignId,
              mediaId: p.mediaId ?? null,
              timestampStart: new Date(p.timestampStart),
              timestampEnd: new Date(p.timestampEnd),
              latStart: p.latStart,
              lngStart: p.lngStart,
              latEnd: p.latEnd,
              lngEnd: p.lngEnd,
              triggerReason: p.triggerReason,
              batteryLevel: p.batteryLevel,
              networkType: p.networkType,
              gpsAccuracyM: p.gpsAccuracyM,
              displayLux: p.displayLux ?? null,
              ingestedAt,
              batchId,
              reconciliationStatus: 'pending',
              billable: false,
              impliedSpeedKmh: null,
              heartbeatRatio: null,
            },
          },
          { upsert: true }
        );

        await this.reconciliation.reconcileOne(deviceId, p.uniqueEventId);
        await this.fraud.applyFraudRules(deviceId, p.uniqueEventId);

        /**
         * Reivindica o direito de cobrar esta veiculação, **uma vez**.
         *
         * O que havia antes: lia o registro, reconciliava, lia de novo e cobrava quando a
         * primeira leitura dizia `pending` e a segunda dizia `billable`. A condição descrevia
         * uma transição, mas era calculada sobre duas leituras separadas por três chamadas de
         * I/O. Dois trabalhadores processando o mesmo lote — o que é normal, porque o tablet
         * reenvia o lote depois de um timeout — liam `pending` os dois antes de qualquer um
         * escrever, enxergavam a mesma transição, e somavam o custo duas vezes no
         * `campaign_daily_spend`. O repasse ao motorista escapava por ter `referenceId`
         * próprio; o gasto da campanha não tinha proteção nenhuma.
         *
         * Hoje existe uma concorrência só porque há um trabalhador e o BullMQ roda um job por
         * vez por processo. Bastava subir a concorrência, ou uma segunda réplica da API, para
         * o defeito acordar — e os dois são mudanças que ninguém associaria a faturamento.
         *
         * `findOneAndUpdate` é atômico no documento no Mongo, então exatamente um chamador
         * recebe o documento de volta. Quem recebe, cobra. É a mesma ideia do `referenceId` do
         * repasse, aplicada ao lado que faltava.
         */
        const claimed = await this.playRecords
          .findOneAndUpdate(
            {
              deviceId,
              uniqueEventId: p.uniqueEventId,
              reconciliationStatus: 'billable',
              billable: true,
              // `null` no Mongo casa com nulo explícito e com campo ausente, então registro
              // gravado antes deste campo existir também é reivindicável.
              billingAppliedAt: null,
            },
            { $set: { billingAppliedAt: new Date() } },
            { new: true }
          )
          .lean()
          .exec();

        if (claimed) {
          const campaign = await this.campaigns.findByCampaignId(
            claimed.campaignId
          );
          /**
           * Custo da veiculação, em micro-reais.
           *
           * Campanha antiga é `per_impression` e continua custando a tarifa fixa que o
           * anunciante digitou. Campanha nova é `per_second`: preço por segundo × segundos de
           * tela, com imagem valendo `imageDisplaySeconds` e vídeo a própria duração.
           *
           * A unidade é micro-real porque R$ 0,003/s é 0,3 centavo e uma imagem de 15 s custa
           * 4,5 centavos — não cabe em centavo inteiro. Ver `monetization/pricing.policy.ts`.
           *
           * Tarifa zero custa zero, e é a resposta correta: há inventário institucional e
           * filler, que toca sem faturar.
           */
          const monetizacao = this.platform.get().monetization;
          const criativo = claimed.mediaId
            ? await this.mediaAssets
                .findOne({ mediaId: claimed.mediaId })
                .select({ duration: 1, mimeType: 1, filename: 1 })
                .lean()
                .exec()
            : null;
          const segundos = segundosCobrados(
            {
              kind: criativo ? tipoDoCriativo(criativo) : 'video',
              durationSec: criativo?.duration ?? null,
            },
            monetizacao.imageDisplaySeconds
          );
          const custoMicros = custoEmMicros({
            preco: {
              modelo: campaign?.budget?.pricingModel ?? 'per_impression',
              pricePerSecondMicros: campaign?.budget?.pricePerSecondMicros ?? null,
              ratePerImpressionCents: campaign?.budget?.ratePerImpressionCents ?? 0,
            },
            segundos,
            pricePerSecondMicrosPadrao: monetizacao.pricePerSecondMicros,
          });

          await this.pacing.recordBillablePlayCost({
            campaignId: claimed.campaignId,
            costMicros: custoMicros,
            at: new Date(claimed.timestampEnd),
          });

          /**
           * O que foi cobrado fica gravado na própria veiculação.
           *
           * Sem isto, o relatório do anunciante só pode recalcular o custo multiplicando
           * exibições pela tarifa **atual** — e um reajuste de preço reescreveria o passado.
           * Com os números gravados, uma contestação futura tem o preço da época.
           */
          await this.playRecords.updateOne(
            { deviceId, uniqueEventId: p.uniqueEventId },
            {
              $set: {
                billedSeconds: segundos,
                billedPricePerSecondMicros:
                  campaign?.budget?.pricingModel === 'per_second'
                    ? (campaign?.budget?.pricePerSecondMicros ??
                      monetizacao.pricePerSecondMicros)
                    : null,
                billedCostMicros: custoMicros,
              },
            }
          );

          // O repasse continua em centavos: é o que o opendriver recebe e lança no extrato do
          // motorista, e aquele lado conta em centavos.
          const costCents = Math.floor(custoMicros / MICROS_POR_CENTAVO);

          /**
           * Este é o único instante em que o repasse pode ser creditado.
           *
           * A reivindicação acima acontece **uma vez** por veiculação, depois de a
           * reconciliação de duração e as regras de antifraude terem passado. Creditar em
           * cima do estado `billable` pagaria de novo a cada reprocessamento do lote.
           *
           * As duas operações ficam juntas de propósito. O pacing debita o orçamento do
           * anunciante e o repasse credita o motorista pela **mesma** veiculação; separá-las
           * em caminhos diferentes criaria o estado em que uma aconteceu e a outra não, sem
           * nada que o relacione.
           */
          await this.creditarRepasse(claimed, costCents);
        }

        /**
         * Estado final, só para o registro de log.
         *
         * A reivindicação devolve o documento quando cobra, mas o log precisa do estado em
         * **todos** os casos — inclusive veredito de fraude e veiculação parcial, que são
         * justamente os que interessam diagnosticar. Uma leitura aqui custa o mesmo que o par
         * `pre`/`updated` que existia antes.
         */
        const final =
          claimed ??
          (await this.playRecords
            .findOne({ deviceId, uniqueEventId: p.uniqueEventId })
            .lean()
            .exec());

        const status = final?.reconciliationStatus;
        const fraudSignal =
          status === 'blackout' ||
          status === 'fraud_velocity' ||
          status === 'fraud_heartbeat';
        this.log.log(
          JSON.stringify({
            event: 'analytics.play.reconciled',
            deviceId,
            uniqueEventId: p.uniqueEventId,
            status,
            billable: final?.billable,
            // Deixa explícito no log se esta execução cobrou ou se outra já tinha cobrado.
            cobradoAgora: claimed !== null,
            impliedSpeedKmh: final?.impliedSpeedKmh ?? null,
            heartbeatRatio: final?.heartbeatRatio ?? null,
            fraudSignal,
          })
        );
      } catch (err: unknown) {
        this.log.warn(
          {
            event: 'analytics.play.insert_failed',
            deviceId,
            uniqueEventId: p.uniqueEventId,
            err,
          },
          'play insert failed'
        );
        throw err;
      }
    }
  }
}
