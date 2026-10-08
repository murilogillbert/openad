import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

export interface CobrancaPix {
  externalId: string;
  copyPaste: string;
  expiresAt: string | null;
}

/**
 * Pede ao **hub** que crie a cobrança Pix do crédito de veiculação.
 *
 * ============================================================================
 * Por que o hub, e não o Asaas direto daqui
 * ============================================================================
 *
 * A integração com o Asaas já existe no hub, completa e exercitada: tokeniza cartão, cria Pix
 * com QR, faz split por carteira de parceiro, e o webhook **reconsulta o status no Asaas** em
 * vez de confiar no corpo recebido. Duplicá-la aqui significaria duas implementações do mesmo
 * provedor, duas cópias do tratamento de erro, e — o pior — a chave do Asaas em dois lugares.
 *
 * As credenciais vivem em `public.integration_settings`, que é do hub. Ler o segredo de outro
 * serviço funcionaria tecnicamente e quebraria a regra de propriedade do banco compartilhado
 * que o ecossistema inteiro segue: só o dono mexe no seu schema.
 *
 * ============================================================================
 * Falha é explícita, não silenciosa
 * ============================================================================
 *
 * Diferente do repasse ao motorista (`DriverEarningClient`), que é best-effort porque o lote de
 * analytics não pode falhar por causa dele, aqui a falha **tem** de chegar ao anunciante: ele
 * está na tela esperando um código Pix. Devolver sucesso sem cobrança o deixaria aguardando um
 * pagamento que nunca foi pedido.
 */
@Injectable()
export class PixChargeClient {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(PixChargeClient.name);
  }

  private baseUrl(): string {
    return (process.env.HUB_API_URL ?? '').trim().replace(/\/+$/, '');
  }

  private apiKey(): string {
    return (process.env.ECOSYSTEM_SERVICE_API_KEY ?? '').trim();
  }

  /** `false` quando falta configuração: a rota recusa com mensagem clara em vez de falhar. */
  habilitado(): boolean {
    return Boolean(this.baseUrl() && this.apiKey());
  }

  async criar(params: {
    purchaseId: string;
    advertiserUserId: string;
    amountCents: number;
    description: string;
  }): Promise<CobrancaPix> {
    const base = this.baseUrl();
    if (!base || !this.apiKey()) {
      throw new Error(
        'HUB_API_URL ou ECOSYSTEM_SERVICE_API_KEY ausente; nao foi possivel criar a cobranca Pix.'
      );
    }

    const res = await fetch(`${base}/api/v1/internal/ads/credit-charges`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey()}`,
      },
      body: JSON.stringify({
        /**
         * `reference` é o identificador do **nosso** pedido, e é por ele que a confirmação
         * volta. Mandar o id da compra, e não um valor novo, é o que liga os dois lados sem
         * precisar de uma tabela de correspondência.
         */
        reference: params.purchaseId,
        userId: params.advertiserUserId,
        amountCents: params.amountCents,
        description: params.description,
      }),
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      this.logger.warn({
        event: 'credito.pix.criacao_falhou',
        purchaseId: params.purchaseId,
        status: res.status,
        corpo: corpo.slice(0, 400),
      });
      throw new Error(`O hub recusou criar a cobranca Pix (HTTP ${res.status}).`);
    }

    // O hub responde com envelope `{ data }`, como o resto do ecossistema.
    const json = (await res.json()) as { data?: CobrancaPix } & Partial<CobrancaPix>;
    const dados = json.data ?? (json as CobrancaPix);
    if (!dados?.externalId || !dados?.copyPaste) {
      throw new Error('A resposta do hub nao trouxe a cobranca Pix completa.');
    }
    return {
      externalId: dados.externalId,
      copyPaste: dados.copyPaste,
      expiresAt: dados.expiresAt ?? null,
    };
  }
}
