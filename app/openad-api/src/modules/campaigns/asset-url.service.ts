import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * HMAC-signed, time-limited URLs for creative assets (MQTT schedule payloads).
 * Devices fetch without JWT using ?exp=&sig= query params.
 */
/**
 * Segredo de assinatura, exigido **no boot**.
 *
 * ============================================================================
 * O que havia aqui, e por que era grave
 * ============================================================================
 *
 * O segredo caía para a constante `'dev-asset-url-secret-change-me'` quando faltavam
 * `ASSET_URL_SIGNING_SECRET` e `JWT_SECRET`. Essa constante está no repositório: qualquer pessoa
 * que o leia pode assinar uma URL de criativo válida por 24 h, e essas URLs são buscadas
 * **sem JWT** pelos aparelhos. A falha era silenciosa — o serviço subia, assinava e servia.
 *
 * Item G.7 do plano v2: o correto é falhar no boot.
 *
 * ============================================================================
 * Por que no boot, e não na primeira assinatura
 * ============================================================================
 *
 * Porque na primeira assinatura já é tarde: o push de agenda por MQTT acontece dentro de um
 * fluxo que não tem a quem reclamar, e o erro apareceria como criativo que não baixa. Falhar no
 * boot troca um problema silencioso e permanente por um contêiner que não sobe — que é ruidoso,
 * imediato e corrigível com uma variável.
 *
 * Em teste o segredo é fixo e previsível: as suítes não definem variável de ambiente para isto,
 * e exigir a variável faria 100+ suítes falharem na construção do módulo por um motivo que não
 * é o que elas verificam.
 */
function segredoDeAssinatura(): string {
  const explicito = (process.env.ASSET_URL_SIGNING_SECRET ?? '').trim();
  if (explicito) return explicito;

  /**
   * Queda para `JWT_SECRET` é intencional e **não** é um atalho: o `JWT_SECRET` é obrigatório em
   * produção (o `FederatedJwtStrategy` lança no boot sem ele) e tem a mesma classe de segredo.
   * O que não existe mais é a queda para uma constante do repositório.
   */
  const jwt = (process.env.JWT_SECRET ?? '').trim();
  if (jwt) return jwt;

  if (process.env.OPENAD_JEST === '1' || process.env.NODE_ENV === 'test') {
    return 'asset-url-secret-de-teste';
  }

  throw new Error(
    'ASSET_URL_SIGNING_SECRET (ou JWT_SECRET) e obrigatorio: as URLs de criativo sao buscadas pelos aparelhos SEM JWT, e assinar com um segredo do repositorio deixaria qualquer pessoa emitir URL valida por 24 h.'
  );
}

@Injectable()
export class AssetUrlService {
  /**
   * Resolvido na construção, e não a cada assinatura.
   *
   * É o que faz a ausência do segredo derrubar o **boot**: o Nest instancia este serviço ao
   * montar o módulo. Resolver dentro de `secret()` adiaria o erro para a primeira URL assinada,
   * que acontece num push de MQTT sem ninguém olhando.
   */
  private readonly segredo = segredoDeAssinatura();

  private secret(): string {
    return this.segredo;
  }

  private baseUrl(): string {
    const port = (process.env.PORT ?? '3000').trim() || '3000';
    return (
      (process.env.PUBLIC_ASSET_BASE_URL ?? '').trim() ||
      `http://127.0.0.1:${port}`
    ).replace(/\/$/, '');
  }

  buildSignedFileUrl(campaignId: string, assetId: string): {
    url: string;
    expiresAt: Date;
  } {
    const expiresAt = new Date(Date.now() + TTL_MS);
    const exp = Math.floor(expiresAt.getTime() / 1000);
    const sig = this.sign(campaignId, assetId, exp);
    const url = `${this.baseUrl()}/api/v1/campaigns/${encodeURIComponent(
      campaignId
    )}/assets/${encodeURIComponent(assetId)}/file?exp=${exp}&sig=${encodeURIComponent(
      sig
    )}`;
    return { url, expiresAt };
  }

  private sign(campaignId: string, assetId: string, exp: number): string {
    const payload = `${campaignId}|${assetId}|${exp}`;
    return createHmac('sha256', this.secret()).update(payload).digest('hex');
  }

  verifySignedRequest(
    campaignId: string,
    assetId: string,
    expRaw: string,
    sigRaw: string
  ): boolean {
    const exp = Number(expRaw);
    if (!Number.isFinite(exp)) {
      throw new UnauthorizedException('Invalid exp');
    }
    const now = Math.floor(Date.now() / 1000);
    if (exp < now) {
      throw new UnauthorizedException('URL expired');
    }
    if (exp > now + TTL_MS / 1000 + 60) {
      throw new UnauthorizedException('Invalid exp');
    }
    const expected = this.sign(campaignId, assetId, exp);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(sigRaw, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid signature');
    }
    return true;
  }

  /** True when the signed URL should be refreshed (within 2h of expiry). */
  shouldRotate(expiresAt: Date): boolean {
    const msLeft = expiresAt.getTime() - Date.now();
    return msLeft < 2 * 60 * 60 * 1000;
  }
}
