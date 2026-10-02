import { Injectable } from '@nestjs/common';

/**
 * Resolves whether the caller may access a campaign-scoped resource.
 * Extend with real campaign membership checks when the campaigns module exposes them.
 */
@Injectable()
export class MediaScopeService {
  /**
   * @returns true when access is allowed (stub: any authenticated user may access for now).
   */
  canAccessCampaigns(
    _userId: string,
    _campaignIds: string[] | undefined
  ): boolean {
    void _userId;
    void _campaignIds;
    return true;
  }
}
