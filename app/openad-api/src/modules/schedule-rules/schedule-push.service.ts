import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { schedulePayloadSchema } from '@openad/mqtt-contracts';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { MqttService } from '../../infrastructure/mqtt/mqtt.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { CreativeAssetsRepository } from '../campaigns/creative-assets.repository';
import { GeoZonesRepository } from '../geo-zones/geo-zones.repository';
import { VehiclesRepository } from '../vehicles/vehicles.repository';
import { AssetUrlService } from '../campaigns/asset-url.service';
import { ScheduleRulesRepository } from './schedule-rules.repository';

const SCHEDULE_CACHE_TTL_SEC = 300;

@Injectable()
export class SchedulePushService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly mqtt: MqttService,
    private readonly redis: RedisService,
    private readonly campaigns: CampaignsRepository,
    private readonly assets: CreativeAssetsRepository,
    private readonly zones: GeoZonesRepository,
    private readonly rules: ScheduleRulesRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly assetUrls: AssetUrlService
  ) {
    this.logger.setContext(SchedulePushService.name);
  }

  /**
   * Pushes updated schedules to all devices that may be affected by this campaign's rules.
   */
  async pushForCampaign(campaignId: string, audit: FleetAuditContext): Promise<void> {
    const campaignRules = await this.rules.findActiveByCampaignId(campaignId);
    if (campaignRules.length === 0) {
      this.logger.info(
        { ...audit, event: 'schedule.push.campaign', campaignId, targetDeviceCount: 0 },
        'no active rules for campaign; skipping push'
      );
      return;
    }
    const vehicles = await this.vehicles.findActiveWithPairedDevices();
    const deviceIds = vehicles.flatMap((v) => v.pairedDeviceIds ?? []);

    this.logger.info(
      {
        ...audit,
        event: 'schedule.push.campaign',
        campaignId,
        targetDeviceCount: deviceIds.length,
      },
      'schedule push for campaign'
    );

    for (const deviceId of deviceIds) {
      await this.buildAndPublishForDevice(deviceId, audit);
    }
  }

  /** Build merged active schedule rules (campaign geo-zones) and publish to the device. */
  async buildAndPublishForDevice(
    deviceId: string,
    audit: FleetAuditContext
  ): Promise<void> {
    const vehicle = await this.vehicles.findByPairedDeviceId(deviceId);
    if (!vehicle) {
      this.logger.warn(
        { ...audit, event: 'schedule.push.skip', deviceId, reason: 'no_vehicle' },
        'no vehicle for paired device'
      );
      return;
    }

    const activeRules = await this.rules.findMany({
      status: 'active',
    });

    const rulesPayload: Record<string, unknown>[] = [];
    for (const r of activeRules) {
      const campaign = await this.campaigns.findByCampaignId(r.campaignId);
      const asset = await this.assets.findByAssetId(r.assetId);
      if (!campaign || !asset || asset.status !== 'verified') continue;

      const zoneDocs = await this.zones.findByZoneIds(r.geoZoneIds);
      const geoZones = zoneDocs.map((z) => {
        const g = z.geometry;
        if (g.type === 'Polygon') {
          return {
            zoneId: z.zoneId,
            geometry: { type: g.type, coordinates: g.coordinates },
          };
        }
        return {
          zoneId: z.zoneId,
          geometry: {
            type: g.type,
            center: g.center,
            radiusMeters: g.radiusMeters,
          },
        };
      });

      const { url: assetUrl } = this.assetUrls.buildSignedFileUrl(
        r.campaignId,
        asset.assetId
      );

      const effectivePriority = r.priority ?? campaign.priority;

      rulesPayload.push({
        ruleId: r.ruleId,
        priority: effectivePriority,
        assetId: asset.assetId,
        assetUrl,
        assetChecksumSha256: asset.checksumSha256,
        assetVersion: asset.version,
        geoZones,
        timeWindows: r.timeWindows,
        dwellThresholdSeconds: r.dwellThresholdSeconds,
        validUntil: campaign.scheduledEnd.toISOString(),
      });
    }

    rulesPayload.sort(
      (a, b) => (a['priority'] as number) - (b['priority'] as number)
    );

    const payload = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      rules: rulesPayload,
      fallbackAssetId: null as string | null,
    };

    const parsed = schedulePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.logger.error(
        { ...audit, err: parsed.error.flatten(), deviceId },
        'schedule payload failed MQTT contract validation'
      );
      throw new Error('Invalid schedule payload');
    }

    const topic = `openad/${deviceId}/schedule`;
    await this.mqtt.publish(topic, parsed.data, 1, true);
    await this.redis.set(
      `cache:schedule:${deviceId}`,
      JSON.stringify(parsed.data),
      SCHEDULE_CACHE_TTL_SEC
    );

    this.logger.info(
      {
        ...audit,
        event: 'schedule.push.device',
        deviceId,
        ruleCount: rulesPayload.length,
      },
      'schedule published and cached'
    );
  }
}
