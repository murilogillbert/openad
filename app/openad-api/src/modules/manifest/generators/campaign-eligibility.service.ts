import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CampaignsRepository } from '../../campaigns/campaigns.repository';
import { PacingSignalService } from '../../analytics/services/pacing-signal.service';
import { PlatformConfigRuntimeService } from '../../platform-config/platform-config-runtime.service';
import {
  boostDeRepasse,
  percentEfetivoDoRepasse,
} from '../../internal/driver-payout.policy';
import { CreditCycleService } from '../../monetization/credit-cycle.service';
import type { Segmentacao } from './targeting-matcher.service';

/** Campanha apta a veicular agora. */
export interface EligibleCampaign {
  campaignId: string;
  /** `campaigns.priority` — 1 e a mais alta. */
  campaignPriority: number;
  /** `campaigns.targeting`. Dimensao vazia = sem restricao. */
  targeting: Segmentacao | null;
  /**
   * Multiplicador do leilao de repasse, de `boostDeRepasse`.
   *
   * Vale 1 quando o leilao esta desligado (`driverPayoutAuctionWeight = 0`) ou quando a
   * campanha oferece exatamente o piso. Acima de 1 ela ganha inventario; e o que impede o
   * piso de virar so um custo fixo que ninguem tem motivo para superar.
   */
  payoutBoost: number;
  /**
   * Cota dura de exibicoes no ciclo, do que resta na reserva de credito.
   *
   * Nulo em inventario institucional (campanha sem anunciante), que toca sem faturar e sem
   * limite de credito.
   */
  creditPlaysInCycle: number | null;
  /** Quando a cota expira, em ISO. Nulo junto com a cota. */
  cycleEndsAt: string | null;
}

/**
 * Prioridade de manifesto para midia sem campanha (institucional, filler).
 *
 * Baixa de proposito: filler continua tocando, mas e o primeiro a ser descartado quando o
 * armazenamento do tablet aperta (`pruneLowestPriorityFirst`).
 */
export const FILLER_MANIFEST_PRIORITY = 100;

/**
 * Converte `campaigns.priority` (1 = mais alta) na prioridade do manifesto, onde maior e
 * mais importante — e a convencao que o player usa para evicao de cache.
 *
 * O piso em `FILLER_MANIFEST_PRIORITY + 10` nao e cosmetico: `campaigns.priority` so e
 * validado como `@Min(1)`, sem teto, entao sem o piso uma campanha cadastrada com
 * prioridade 90 ou mais empataria ou ficaria abaixo do filler institucional e seria
 * descartada antes dele quando o armazenamento do tablet apertasse.
 */
export function manifestPriorityFor(campaignPriority: number): number {
  const clamped = Math.min(Math.max(Math.trunc(campaignPriority), 1), 99);
  return Math.max(FILLER_MANIFEST_PRIORITY + 10, 1000 - clamped * 10);
}

/**
 * Resolve quais campanhas podem veicular neste instante.
 *
 * Existe porque o manifesto nao filtrava nada: `ManifestGeneratorService` devolvia toda a
 * midia com `isActive: true` da plataforma inteira, ordenada por data de criacao. Campanha
 * em `draft`, `completed` ou `archived` continuava sendo distribuida e tocada, campanha
 * fora da janela contratada tambem, e orcamento esgotado nao parava nada.
 */
@Injectable()
export class CampaignEligibilityService {
  constructor(
    private readonly campaigns: CampaignsRepository,
    private readonly pacing: PacingSignalService,
    private readonly platform: PlatformConfigRuntimeService,
    // O portão de crédito. Era o critério que faltava: a elegibilidade não injetava nada que
    // soubesse de dinheiro, então não tinha como consultar saldo.
    private readonly credito: CreditCycleService,
    private readonly logger: PinoLogger
  ) {
    this.logger.setContext(CampaignEligibilityService.name);
  }

  /**
   * Campanhas aptas, indexadas por `campaignId`.
   *
   * Tres criterios: status `active`, instante dentro de
   * `scheduledStart`..`scheduledEnd`, e pacing diario diferente de `paused` — este ultimo e
   * o que impede uma campanha de gastar alem do orcamento do dia.
   */
  async resolveEligible(now: Date = new Date()): Promise<Map<string, EligibleCampaign>> {
    const active = await this.campaigns.findMany({
      status: 'active',
      scheduledStart: { $lte: now },
      scheduledEnd: { $gte: now },
    });

    const eligible = new Map<string, EligibleCampaign>();
    let pausedByPacing = 0;
    let semCredito = 0;

    for (const campaign of active) {
      const snapshot = await this.pacing.getSnapshot(campaign.campaignId);
      if (snapshot?.pacingState === 'paused') {
        pausedByPacing += 1;
        continue;
      }

      /**
       * Portão de crédito: **só vai ao ar o anúncio que tem reserva aberta neste ciclo.**
       *
       * É o critério que faltava. Os três que existiam — status, janela contratada e pacing —
       * nunca consultaram saldo, e o serviço nem injetava o Prisma: não tinha como. O teto que
       * pausava a campanha era `budget`, um valor **declarado pelo anunciante na criação**, não
       * dinheiro recebido. Enquanto isso o motorista era creditado de verdade.
       *
       * A reserva é consultada, e não o saldo: entre esta decisão e a veiculação passam até 15
       * minutos, e o saldo diria "tem dinheiro" para todas as campanhas e todos os tablets ao
       * mesmo tempo. A reserva é o compromisso já firmado para este ciclo.
       *
       * **Campanha sem anunciante não é bloqueada.** É inventário institucional criado pelo
       * operador: toca sem faturar, e não há crédito a reservar. Exigir reserva dela tiraria do
       * ar justamente o conteúdo que existe para preencher a grade.
       */
      let hold: Awaited<ReturnType<CreditCycleService['reservaAberta']>> = null;
      if (campaign.advertiserId) {
        hold = await this.credito.reservaAberta(campaign.campaignId, now);
        if (!hold || hold.playsRestantes <= 0) {
          semCredito += 1;
          continue;
        }
      }

      const monetizacao = this.platform.get().monetization;
      eligible.set(campaign.campaignId, {
        campaignId: campaign.campaignId,
        campaignPriority: campaign.priority,
        /**
         * Cota dura do ciclo e quando ela expira, repassados ao tablet pelo manifesto.
         *
         * **Sem a cota, a reserva não limita nada.** O tablet toca em laço: é ele que decide
         * quantas vezes exibe. A reserva garante que só se captura o que foi reservado, mas sem
         * a cota o aparelho exibe além dela — e a exibição excedente não fatura, então o
         * anunciante recebe entrega que não pagou e o motorista não é creditado por ela.
         *
         * Nulos em inventário institucional, que não tem reserva nem limite.
         */
        creditPlaysInCycle: hold?.playsRestantes ?? null,
        cycleEndsAt: hold?.closesAt?.toISOString() ?? null,
        targeting: campaign.targeting
          ? {
              cities: campaign.targeting.cities ?? [],
              zoneIds: campaign.targeting.zoneIds ?? [],
              tiers: campaign.targeting.tiers ?? [],
              vehicleTiers: campaign.targeting.vehicleTiers ?? [],
              dayparts: campaign.targeting.dayparts ?? [],
            }
          : null,
        payoutBoost: boostDeRepasse({
          percentEfetivo: percentEfetivoDoRepasse(
            campaign.driverPayout,
            campaign.budget?.ratePerImpressionCents ?? 0,
            monetizacao.driverPayoutMinPercent,
            /**
             * O teto entra também aqui, e não só no pagamento.
             *
             * Sem ele, campanha gravada com `percent: 1` antes do teto existir teria o peso
             * do leilão calculado sobre 100% e atropelaria as outras — comprando entrega com
             * um repasse que o pagamento já não honra.
             */
            monetizacao.driverPayoutMaxPercent
          ),
          piso: monetizacao.driverPayoutMinPercent,
          k: monetizacao.driverPayoutAuctionWeight,
        }),
      });
    }

    void this.logger.debug(
      {
        event: 'manifest.eligibility.resolved',
        activeInWindow: active.length,
        eligible: eligible.size,
        pausedByPacing,
        // Separado do pacing de propósito: "pausada por orçamento do dia" e "sem crédito
        // reservado" são problemas diferentes e levam a ações diferentes do operador.
        semCredito,
      },
      'campanhas aptas resolvidas'
    );

    return eligible;
  }
}
