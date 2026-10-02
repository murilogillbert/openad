import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  DashboardActivityItem,
  DashboardCampaignPacingItem,
  DashboardCriticalAlert,
  DashboardSummaryResponse,
  FleetStatusItem,
} from '@openad/api-contracts';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import type { CampaignDocument } from '../campaigns/campaign.schema';
import { FleetQueryService } from '../fleet-monitor/fleet-query.service';
import { ImpressionEventsRepository } from '../impressions/impression-events.repository';
import type { MediaAssetDocument } from '../media-ingestion/schemas/media-asset.schema';
import { MediaAsset } from '../media-ingestion/schemas/media-asset.schema';
import type { ReportJobDocument } from '../reporting/report-job.schema';
import { ReportJobRecord } from '../reporting/report-job.schema';
import { PlatformConfigRuntimeService } from '../platform-config/platform-config-runtime.service';

const PACING_LIMIT = 5;
const STALE_REPORTED_MS = 120_000;
const URGENT_FLAG = /temp|heat|thermal|critical|emergency|fail|overheat/i;

@Injectable()
export class DashboardService {
  constructor(
    private readonly platform: PlatformConfigRuntimeService,
    private readonly fleetQuery: FleetQueryService,
    private readonly campaignsRepo: CampaignsRepository,
    private readonly impressions: ImpressionEventsRepository,
    @InjectModel(MediaAsset.name)
    private readonly mediaModel: Model<MediaAssetDocument>,
    @InjectModel(ReportJobRecord.name)
    private readonly reportModel: Model<ReportJobDocument>
  ) {}

  async getSummary(): Promise<DashboardSummaryResponse> {
    const now = new Date();
    const generatedAt = now.toISOString();

    const [
      fleetRes,
      activeCampaignDocs,
      impressionBuckets,
      mediaAgg,
      recentMedia,
      recentReports,
      lastReadyReport,
    ] = await Promise.all([
      this.fleetQuery.getStatus(),
      this.loadActiveCampaigns(now),
      this.loadImpressionBuckets(now),
      this.mediaModel
        .aggregate<{ total: number }>([
          { $match: { isActive: true } },
          { $group: { _id: null as null, total: { $sum: '$fileSize' } } },
        ])
        .exec(),
      this.mediaModel
        .find({ isActive: true })
        .sort({ createdAt: -1 })
        .limit(8)
        .select('mediaId filename uploadedBy createdAt')
        .lean()
        .exec(),
      this.reportModel
        .find({})
        .sort({ updatedAt: -1 })
        .limit(8)
        .select('jobId campaignId format status updatedAt createdAt')
        .lean()
        .exec(),
      this.reportModel
        .findOne({ status: 'ready' })
        .sort({ updatedAt: -1 })
        .select('updatedAt')
        .lean()
        .exec() as Promise<{ updatedAt?: Date } | null>,
    ]);

    const fleetData = fleetRes.data;
    const online = fleetData.filter(
      (d) => d.connectivity.status === 'online'
    ).length;
    const total = fleetData.length;
    const devicesPlaying = fleetData.filter(
      (d) => d.playback.status === 'playing'
    ).length;
    const activeCampaignCount = activeCampaignDocs.length;

    const impression24h = impressionBuckets.current24h;
    const prior24h = impressionBuckets.prior24h;
    const deltaPercent =
      prior24h > 0
        ? Math.round(((impression24h - prior24h) / prior24h) * 1000) / 10
        : null;

    const usedBytes = Math.round(mediaAgg[0]?.total ?? 0);
    const quotaBytes =
      this.platform.get().dashboard.mediaStorageQuotaBytes != null
        ? Math.max(1, Math.floor(this.platform.get().dashboard.mediaStorageQuotaBytes))
        : null;
    const usedPercent =
      quotaBytes != null
        ? Math.min(100, Math.round((usedBytes / quotaBytes) * 1000) / 10)
        : null;

    const pacing = await this.buildCampaignPacing(activeCampaignDocs, now);

    const criticalAlerts = this.buildFleetAlerts(fleetData);
    const operationalStatus = this.computeOperationalStatus(
      fleetData,
      criticalAlerts
    );

    const activity = this.mergeActivityFeed(recentMedia, recentReports, now);

    const segmentFill = this.segmentFillForCampaigns(activeCampaignCount);

    return {
      generatedAt,
      fleet: {
        data: fleetData,
        staleBefore: fleetRes.staleBefore,
      },
      operationalStatus,
      kpis: {
        networkOnline: online,
        networkTotal: total,
        activeCampaigns: {
          count: activeCampaignCount,
          segmentFill,
          devicesPlaying,
        },
        impressions24h: {
          count: impression24h,
          priorWindowCount: prior24h,
          deltaPercent,
          sparklineDailyCounts: impressionBuckets.last7Days,
        },
        mediaStorage: {
          usedBytes,
          quotaBytes,
          usedPercent,
        },
      },
      campaignPacing: pacing,
      criticalAlerts,
      activity,
      proofOfPlay: {
        lastReadyAt: lastReadyReport?.updatedAt
          ? new Date(lastReadyReport.updatedAt).toISOString()
          : null,
      },
    };
  }

  private async loadActiveCampaigns(now: Date): Promise<CampaignDocument[]> {
    return this.campaignsRepo.findMany(
      {
        status: 'active',
        scheduledStart: { $lte: now },
        scheduledEnd: { $gte: now },
      },
      { sort: { priority: 1 } }
    );
  }

  private async loadImpressionBuckets(now: Date): Promise<{
    current24h: number;
    prior24h: number;
    last7Days: number[];
  }> {
    const msDay = 86_400_000;
    const start24h = new Date(now.getTime() - msDay);
    const start48h = new Date(now.getTime() - 2 * msDay);
    const start7d = new Date(now.getTime() - 7 * msDay);

    const [current24h, prior24h, dailyAgg] = await Promise.all([
      this.impressions.countPlayedSince(start24h),
      this.impressions.countPlayedBetween(start48h, start24h),
      this.impressions
        .aggregate([
          { $match: { playedAt: { $gte: start7d } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$playedAt',
                  timezone: 'UTC',
                },
              },
              c: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .then((rows) => rows as Array<{ _id: string; c: number }>),
    ]);

    const byDay = new Map(dailyAgg.map((d) => [d._id, d.c]));
    const last7Days: number[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() - i
        )
      );
      const key = d.toISOString().slice(0, 10);
      last7Days.push(byDay.get(key) ?? 0);
    }

    return { current24h, prior24h, last7Days };
  }

  private async buildCampaignPacing(
    active: CampaignDocument[],
    now: Date
  ): Promise<DashboardCampaignPacingItem[]> {
    if (active.length === 0) return [];

    const ids = active.map((c) => c.campaignId);
    const counts = (await this.impressions.aggregate([
      { $match: { campaignId: { $in: ids } } },
      { $group: { _id: '$campaignId', n: { $sum: 1 } } },
    ])) as Array<{ _id: string; n: number }>;

    const countMap = new Map(counts.map((x) => [x._id, x.n]));

    const items: DashboardCampaignPacingItem[] = [];
    for (const c of active) {
      const rate = c.budget?.ratePerImpression ?? 0;
      const totalAmt = c.budget?.totalAmount ?? 0;
      const targetImpressions =
        rate > 0 ? Math.max(0, Math.floor(totalAmt / rate)) : 0;
      const actual = countMap.get(c.campaignId) ?? 0;
      const pctOfTarget =
        targetImpressions > 0
          ? Math.round((actual / targetImpressions) * 1000) / 10
          : actual > 0
            ? 100
            : 0;

      const span = c.scheduledEnd.getTime() - c.scheduledStart.getTime();
      const expectedProgressPercent =
        span <= 0
          ? 100
          : Math.min(
              100,
              Math.max(
                0,
                Math.round(
                  ((now.getTime() - c.scheduledStart.getTime()) / span) * 1000
                ) / 10
              )
            );

      let tone: DashboardCampaignPacingItem['tone'] = 'primary';
      if (pctOfTarget >= 105) tone = 'emerald';
      else if (pctOfTarget <= 70) tone = 'error';

      items.push({
        campaignId: c.campaignId,
        name: c.name,
        pctOfTarget,
        targetImpressions,
        actualImpressions: actual,
        expectedProgressPercent,
        tone,
      });
    }

    items.sort((a, b) => b.actualImpressions - a.actualImpressions);
    return items.slice(0, PACING_LIMIT);
  }

  private buildFleetAlerts(fleet: FleetStatusItem[]): DashboardCriticalAlert[] {
    const out: DashboardCriticalAlert[] = [];
    for (const item of fleet) {
      const flags = item.alertFlags ?? [];
      if (flags.length === 0) continue;
      const title = item.vehicleId || item.deviceId;
      const detail = flags.join(' · ');
      const urgent = flags.some((f) => URGENT_FLAG.test(f));
      out.push({
        id: `fleet:${item.deviceId}:${item.reportedAt}`,
        title,
        detail,
        occurredAt: item.reportedAt,
        urgent,
      });
    }
    out.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    );
    return out.slice(0, 8);
  }

  private computeOperationalStatus(
    fleet: FleetStatusItem[],
    alerts: DashboardCriticalAlert[]
  ): DashboardSummaryResponse['operationalStatus'] {
    const total = fleet.length;
    const urgentCount = alerts.filter((a) => a.urgent).length;
    const offline = fleet.filter(
      (d) => d.connectivity.status === 'offline'
    ).length;
    const degradedConn = fleet.filter(
      (d) => d.connectivity.status === 'degraded'
    ).length;
    const stale = fleet.filter(
      (d) => new Date(d.reportedAt).getTime() < Date.now() - STALE_REPORTED_MS
    ).length;
    const playbackErrors = fleet.filter(
      (d) => d.playback.status === 'error'
    ).length;

    if (total === 0) {
      return {
        state: 'degraded',
        headline: 'No fleet telemetry',
        detail:
          'No devices have reported status yet. Pair screens or verify connectivity.',
      };
    }

    if (
      urgentCount > 0 ||
      offline / total >= 0.25 ||
      playbackErrors / total >= 0.2
    ) {
      return {
        state: 'critical',
        headline: 'Attention required',
        detail: this.joinParts([
          urgentCount > 0
            ? `${urgentCount} urgent alert(s) from the fleet`
            : null,
          offline > 0 ? `${offline} screen(s) offline` : null,
          playbackErrors > 0
            ? `${playbackErrors} playback error(s)`
            : null,
        ]),
      };
    }

    if (offline > 0 || degradedConn > 0 || stale > Math.max(1, total * 0.15)) {
      return {
        state: 'degraded',
        headline: 'Elevated risk',
        detail: this.joinParts([
          offline > 0 ? `${offline} offline` : null,
          degradedConn > 0 ? `${degradedConn} degraded link(s)` : null,
          stale > 0 ? `${stale} stale report(s) (>2m)` : null,
        ]),
      };
    }

    return {
      state: 'optimal',
      headline: 'System optimal',
      detail:
        'Fleet telemetry is current and connected screens are within normal parameters.',
    };
  }

  private joinParts(parts: Array<string | null>): string {
    return parts.filter(Boolean).join(' · ') || 'Review fleet status.';
  }

  private segmentFillForCampaigns(activeCount: number): number {
    if (activeCount <= 0) return 0;
    return Math.min(4, Math.max(1, Math.ceil((activeCount / 12) * 4)));
  }

  private mergeActivityFeed(
    media: Array<{
      mediaId: string;
      filename: string;
      uploadedBy?: string;
      createdAt?: Date;
    }>,
    reports: Array<{
      jobId: string;
      campaignId: string;
      format: string;
      status: string;
      updatedAt?: Date;
      createdAt?: Date;
    }>,
    now: Date
  ): DashboardActivityItem[] {
    const rows: DashboardActivityItem[] = [];

    for (const m of media) {
      const at = m.createdAt ?? now;
      const who = m.uploadedBy?.trim() || 'system';
      rows.push({
        id: `media:${m.mediaId}`,
        at: new Date(at).toISOString(),
        label: `Media uploaded: '${m.filename}' by ${who}`,
      });
    }

    for (const r of reports) {
      const at = r.updatedAt ?? r.createdAt ?? now;
      const st = r.status;
      const shortCamp =
        r.campaignId.length > 14
          ? `${r.campaignId.slice(0, 12)}…`
          : r.campaignId;
      let label: string;
      if (st === 'ready') {
        label = `Proof-of-play report ready (${r.format}) — ${shortCamp}`;
      } else if (st === 'failed') {
        label = `Report job failed (${r.format}) — ${shortCamp}`;
      } else if (st === 'processing') {
        label = `Report generating (${r.format}) — ${shortCamp}`;
      } else {
        label = `Report queued (${r.format}) — ${shortCamp}`;
      }
      rows.push({
        id: `report:${r.jobId}`,
        at: new Date(at).toISOString(),
        label,
      });
    }

    rows.sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
    );
    return rows.slice(0, 15);
  }
}
