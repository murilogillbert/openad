import { z } from 'zod';

const fleetStatusItemSchema = z.object({
  deviceId: z.string(),
  vehicleId: z.string(),
  reportedAt: z.string(),
  location: z.object({ lng: z.number(), lat: z.number() }),
  connectivity: z.object({
    status: z.enum(['online', 'degraded', 'offline']),
  }),
  playback: z.object({
    status: z.enum(['playing', 'idle', 'error']),
    currentCampaignId: z.string().nullable(),
  }),
  alertFlags: z.array(z.string()),
});

const fleetSnapshotSchema = z.object({
  data: z.array(fleetStatusItemSchema),
  staleBefore: z.string(),
});

/** GET /api/v1/dashboard/summary (alias: /api/v1/admin/dashboard/summary) — portal dashboard snapshot. */
export const dashboardOperationalStatusSchema = z.object({
  state: z.enum(['optimal', 'degraded', 'critical']),
  headline: z.string(),
  detail: z.string(),
});

export const dashboardKpisSchema = z.object({
  networkOnline: z.number().int().min(0),
  networkTotal: z.number().int().min(0),
  activeCampaigns: z.object({
    count: z.number().int().min(0),
    /** Filled segments (0–4) for the KPI micro-chart. */
    segmentFill: z.number().int().min(0).max(4),
    /** Devices currently playing any campaign (fleet-derived). */
    devicesPlaying: z.number().int().min(0),
  }),
  impressions24h: z.object({
    count: z.number().int().min(0),
    priorWindowCount: z.number().int().min(0),
    /** vs prior 24h window; null when prior is zero. */
    deltaPercent: z.number().nullable(),
    /** Last 7 calendar days (UTC), oldest first — raw counts for chart scaling. */
    sparklineDailyCounts: z.array(z.number().int().min(0)).length(7),
  }),
  mediaStorage: z.object({
    usedBytes: z.number().int().min(0),
    quotaBytes: z.number().int().positive().nullable(),
    usedPercent: z.number().min(0).max(100).nullable(),
  }),
});

export const dashboardCampaignPacingItemSchema = z.object({
  campaignId: z.string(),
  name: z.string(),
  /** Delivered impressions ÷ budget-derived target × 100 (may exceed 100). */
  pctOfTarget: z.number(),
  targetImpressions: z.number().int().min(0),
  actualImpressions: z.number().int().min(0),
  /** Time-based expected delivery progress 0–100 for the target marker in the UI. */
  expectedProgressPercent: z.number().min(0).max(100),
  tone: z.enum(['primary', 'emerald', 'error']),
});

export const dashboardCriticalAlertSchema = z.object({
  id: z.string(),
  title: z.string(),
  detail: z.string(),
  occurredAt: z.string(),
  urgent: z.boolean(),
});

export const dashboardActivityItemSchema = z.object({
  id: z.string(),
  at: z.string(),
  label: z.string(),
});

export const dashboardSummarySchema = z.object({
  generatedAt: z.string(),
  fleet: fleetSnapshotSchema,
  operationalStatus: dashboardOperationalStatusSchema,
  kpis: dashboardKpisSchema,
  campaignPacing: z.array(dashboardCampaignPacingItemSchema),
  criticalAlerts: z.array(dashboardCriticalAlertSchema),
  activity: z.array(dashboardActivityItemSchema),
  proofOfPlay: z.object({
    lastReadyAt: z.string().nullable(),
  }),
});

export type DashboardSummaryResponse = z.infer<typeof dashboardSummarySchema>;
export type DashboardOperationalStatus = z.infer<
  typeof dashboardOperationalStatusSchema
>;
export type DashboardKpis = z.infer<typeof dashboardKpisSchema>;
export type DashboardCampaignPacingItem = z.infer<
  typeof dashboardCampaignPacingItemSchema
>;
export type DashboardCriticalAlert = z.infer<typeof dashboardCriticalAlertSchema>;
export type DashboardActivityItem = z.infer<typeof dashboardActivityItemSchema>;
