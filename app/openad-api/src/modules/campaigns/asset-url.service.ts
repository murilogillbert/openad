import { createHmac, timingSafeEqual } from 'crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * HMAC-signed, time-limited URLs for creative assets (MQTT schedule payloads).
 * Devices fetch without JWT using ?exp=&sig= query params.
 */
@Injectable()
export class AssetUrlService {
  private secret(): string {
    return (
      (process.env.ASSET_URL_SIGNING_SECRET ?? '').trim() ||
      (process.env.JWT_SECRET ?? '').trim() ||
      'dev-asset-url-secret-change-me'
    );
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
