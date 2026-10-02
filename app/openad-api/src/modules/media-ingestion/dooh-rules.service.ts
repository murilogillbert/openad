import { Injectable } from '@nestjs/common';

/**
 * DOOH rule-set tagging and optional env-driven limits (FR-003/FR-004).
 * Validation math remains in {@link VideoValidatorService}; this service exposes version stamps.
 */
@Injectable()
export class DoohRulesService {
  /** Stored on catalog rows as `doohRulesetVersion` for revalidation policy (FR-010). */
  getRulesetVersion(): string {
    const v = (process.env.DOOH_RULESET_VERSION ?? '').trim();
    return v && v.length > 0 ? v : '2026.1';
  }

  /**
   * When `true`, duplicate SHA-256 across the catalog short-circuits a new placement (FR-012).
   */
  dedupEnabled(): boolean {
    const raw = (process.env.MEDIA_VFS_DEDUP ?? '').trim();
    return raw === '1' || raw?.toLowerCase() === 'true';
  }
}
