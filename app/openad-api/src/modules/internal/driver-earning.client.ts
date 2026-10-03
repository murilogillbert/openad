import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/** Teto de espera. Igual ao do hub e do opendriver, para o comportamento ser previsível. */
const TETO_MS = 10_000;

export interface LancamentoDeRepasse {
  driverUserId: string;
  /** Centavos inteiros. O opendriver converte para `Decimal(10,2)` na fronteira. */
  amountCents: number;
  /** Idempotência: `campaignId:uniqueEventId`. Ver a nota em {@link creditar}. */
  referenceId: string;
  campaignId: string;
  description: string;
}

/**
 * Credita o repasse de anúncio no livro-caixa do motorista, que vive no **opendriver**.
 *
 * Por que não no openad: existem duas carteiras de motorista no ecossistema, e esta é a que
 * o motorista de fato olha. `opendriver.driver_earnings` já tem extrato, saldo agregado,
 * `payout_requests` e as telas de saque por PIX prontas. Reimplementar conta de dinheiro
 * aqui significaria uma segunda carteira, uma segunda tela e uma segunda forma de pagar —
 * com a certeza de que as duas divergiriam.
 *
 * Também não vai para `public.users.cashback_balance`: aquele saldo é de cashback de compras,
 * e misturar receita de anúncio ali inviabiliza separar as duas na contabilidade e na
 * conversa com as lojas.
 *
 * A escrita é por HTTP em `/internal/*` autenticado por `public.service_api_keys`, porque
 * `opendriver.driver_earnings` **não é propriedade do openad** — a regra do ecossistema é que
 * só o dono altera o seu schema. Escrever direto no banco funcionaria e seria exatamente o
 * atalho que torna impossível evoluir os dois serviços de forma independente.
 */
@Injectable()
export class DriverEarningClient {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(DriverEarningClient.name);
  }

  private baseUrl(): string {
    return (process.env.OPENDRIVER_API_URL ?? '').trim().replace(/\/+$/, '');
  }

  private apiKey(): string {
    return (process.env.ECOSYSTEM_SERVICE_API_KEY ?? '').trim();
  }

  /** `true` quando há endereço e chave para chamar. */
  habilitado(): boolean {
    return Boolean(this.baseUrl() && this.apiKey());
  }

  /**
   * Lança o crédito. Devolve `true` quando o opendriver confirmou.
   *
   * **Não lança exceção**, e isso é deliberado. Quem chama é o processador de reconciliação
   * de analytics, no meio de um lote de play records. Propagar o erro faria o lote inteiro
   * falhar e ser reprocessado, e o reprocessamento recontaria o pacing das veiculações que já
   * tinham sido contadas — um erro de rede no repasse viraria erro de faturamento. O crédito
   * perdido é recuperável pela conferência de `/internal/ads/payouts`; o faturamento duplicado
   * não é.
   *
   * `referenceId` é `campaignId:uniqueEventId` e vai no corpo para que o opendriver aplique
   * a própria trava de idempotência. É o que torna a retentativa segura: o mesmo play record
   * reprocessado não paga duas vezes.
   */
  async creditar(lancamento: LancamentoDeRepasse): Promise<boolean> {
    const base = this.baseUrl();
    const chave = this.apiKey();

    if (!base || !chave) {
      /**
       * Desligado por ausência de configuração, e isso **não** é erro.
       *
       * Em desenvolvimento e nas suítes não há opendriver de pé. Falhar aqui tornaria a
       * reconciliação de analytics dependente de um segundo serviço para rodar, o que
       * quebraria mais de cem suítes para não ganhar nada. Em produção a ausência aparece no
       * log e na divergência do relatório de conferência.
       */
      this.logger.debug(
        { event: 'repasse.desligado', campaignId: lancamento.campaignId },
        'OPENDRIVER_API_URL ou ECOSYSTEM_SERVICE_API_KEY ausente; repasse nao enviado'
      );
      return false;
    }

    if (lancamento.amountCents <= 0) {
      return false;
    }

    try {
      const res = await fetch(`${base}/api/v1/internal/driver-earnings/ad-revenue`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chave}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(lancamento),
        signal: AbortSignal.timeout(TETO_MS),
      });

      if (res.status === 409) {
        // Já lançado. É o caminho normal de uma retentativa, não um problema.
        this.logger.debug(
          { event: 'repasse.duplicado', referenceId: lancamento.referenceId },
          'lancamento de repasse ja existia'
        );
        return true;
      }

      if (!res.ok) {
        const corpo = await res.text().catch(() => '');
        this.logger.warn(
          {
            event: 'repasse.recusado',
            status: res.status,
            referenceId: lancamento.referenceId,
            corpo: corpo.slice(0, 300),
          },
          'opendriver recusou o lancamento de repasse'
        );
        return false;
      }

      this.logger.info(
        {
          event: 'repasse.creditado',
          driverUserId: lancamento.driverUserId,
          amountCents: lancamento.amountCents,
          campaignId: lancamento.campaignId,
        },
        'repasse de anuncio creditado ao motorista'
      );
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        {
          event: 'repasse.falhou',
          err: msg,
          referenceId: lancamento.referenceId,
        },
        'falha ao creditar repasse; sera recuperavel pela conferencia'
      );
      return false;
    }
  }
}
