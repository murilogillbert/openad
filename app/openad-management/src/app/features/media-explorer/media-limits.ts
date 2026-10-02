/**
 * Client-side preflight — align with API platform config (Settings → Platform) and `VideoValidatorService`.
 * Each axis capped independently (portrait 1080×1350 is valid vs legacy 1920×1080 “box”).
 */
export const MEDIA_CLIENT_LIMITS = {
  maxBytes: 524_288_000,
  maxWidth: 1920,
  maxHeight: 1920,
  allowedExtensions: ['.mp4', '.jpg', '.jpeg', '.png'] as const,
};
