import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { isObservable } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { AssetUrlService } from '../asset-url.service';

const JWT_ROLES = new Set([
  'campaign_manager',
  'fleet_admin',
  'fleet_operator',
  'super_admin',
]);

/**
 * Allows download with either JWT (Passport) or valid `exp` + `sig` query params.
 */
@Injectable()
export class AssetDownloadGuard extends AuthGuard('jwt') {
  constructor(private readonly assetUrls: AssetUrlService) {
    super();
  }

  override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const exp = req.query['exp'];
    const sig = req.query['sig'];
    const campaignId = req.params['campaignId'] as string | undefined;
    const assetId = req.params['assetId'] as string | undefined;
    if (
      typeof exp === 'string' &&
      typeof sig === 'string' &&
      campaignId &&
      assetId
    ) {
      try {
        this.assetUrls.verifySignedRequest(campaignId, assetId, exp, sig);
        return true;
      } catch (e) {
        if (e instanceof UnauthorizedException) throw e;
        throw new UnauthorizedException('Invalid asset URL');
      }
    }

    const raw = super.canActivate(context);
    const result = isObservable(raw)
      ? await lastValueFrom(raw)
      : await Promise.resolve(raw);
    if (!result) {
      return false;
    }

    const user = req.user as { role?: string } | undefined;
    if (!user?.role || !JWT_ROLES.has(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
