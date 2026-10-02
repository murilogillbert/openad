import { Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type {
  FleetMapDeviceDetailResponse,
  FleetMapMarker,
  FleetMapMetaResponse,
  FleetMapMotionState,
  FleetMapSnapshotResponse,
  FleetMapZoneOutline,
} from '@openad/api-contracts';
import { isLngLatInZone } from '../analytics/utils/play-geo.util';
import { AssetUrlService } from '../campaigns/asset-url.service';
import { CampaignsRepository } from '../campaigns/campaigns.repository';
import { CreativeAssetsRepository } from '../campaigns/creative-assets.repository';
import { DevicesRepository } from '../devices/devices.repository';
import type { DeviceDocument } from '../devices/devices.schema';
import { GeoZonesRepository } from '../geo-zones/geo-zones.repository';
import type { GeoZoneDocument } from '../geo-zones/geo-zone.schema';
import { ImpressionEventsRepository } from '../impressions/impression-events.repository';
import { FleetStatusRepository } from '../vehicles/fleet-status.repository';
import type { FleetStatusDocument } from '../vehicles/fleet-status.schema';
import { VehiclesRepository } from '../vehicles/vehicles.repository';

export interface FleetMapQuery {
  cities?: string[];
  deviceName?: string;
  deviceStatuses?: ('online' | 'offline' | 'syncing')[];
  plates?: string;
  commercialTiers?: ('premium' | 'taxi' | 'van' | 'other')[];
  campaignIds?: string[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseListParam(v: unknown): string[] {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) return v.flatMap((x) => String(x).split(',')).map((s) => s.trim()).filter(Boolean);
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function zoneCityForLngLat(
  zoneMap: Map<string, GeoZoneDocument>,
  lng: number,
  lat: number
): string | null {
  for (const z of zoneMap.values()) {
    if (isLngLatInZone(z.geometry, lng, lat)) {
      return z.city;
    }
  }
  return null;
}

function parseFleetMapQuery(q: Record<string, unknown>): FleetMapQuery {
  return {
    cities: parseListParam(q['cities']),
    deviceName:
      typeof q['deviceName'] === 'string' ? q['deviceName'].trim() : undefined,
    deviceStatuses: parseListParam(q['deviceStatuses']) as FleetMapQuery['deviceStatuses'],
    plates: typeof q['plates'] === 'string' ? q['plates'].trim() : undefined,
    commercialTiers: parseListParam(q['commercialTiers']) as FleetMapQuery['commercialTiers'],
    campaignIds: parseListParam(q['campaignIds']),
  };
}

/** Marker visualization + filter bucket for connectivity/playback. */
function mapMarkerState(
  fs: FleetStatusDocument,
  device: DeviceDocument | undefined
): FleetMapMotionState {
  if (fs.connectivity.status === 'offline') {
    return 'offline';
  }
  if (device?.lifecycleState === 'Pending' || fs.connectivity.status === 'degraded') {
    return 'syncing';
  }
  if (fs.playback.status === 'playing') {
    return 'moving';
  }
  return 'idle';
}

function matchesDeviceStatusFilter(
  state: FleetMapMotionState,
  selected: FleetMapQuery['deviceStatuses']
): boolean {
  if (!selected?.length) return true;
  const bucket: 'online' | 'offline' | 'syncing' =
    state === 'offline'
      ? 'offline'
      : state === 'syncing'
        ? 'syncing'
        : 'online';
  return selected.includes(bucket);
}

@Injectable()
export class FleetMapService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly fleetStatus: FleetStatusRepository,
    private readonly vehicles: VehiclesRepository,
    private readonly devices: DevicesRepository,
    private readonly geoZones: GeoZonesRepository,
    private readonly campaigns: CampaignsRepository,
    private readonly impressions: ImpressionEventsRepository,
    private readonly creativeAssets: CreativeAssetsRepository,
    private readonly assetUrls: AssetUrlService
  ) {
    this.logger.setContext(FleetMapService.name);
  }

  async getMeta(): Promise<FleetMapMetaResponse> {
    const [cities, campaignDocs] = await Promise.all([
      this.geoZones.distinctCitiesActive(),
      this.campaigns.findMany(
        { status: { $in: ['active', 'paused'] } },
        { sort: { name: 1 }, limit: 500 }
      ),
    ]);
    return {
      cities: cities.sort(),
      campaigns: campaignDocs.map((c) => ({
        campaignId: c.campaignId,
        name: c.name,
      })),
      commercialTiers: ['premium', 'taxi', 'van', 'other'],
      deviceStatusFilters: ['online', 'offline', 'syncing'],
    };
  }

  private async zoneByIdMap(): Promise<Map<string, GeoZoneDocument>> {
    const zones = await this.geoZones.findActive();
    return new Map(zones.map((z) => [z.zoneId, z]));
  }

  async getSnapshot(
    rawQuery: Record<string, unknown>
  ): Promise<FleetMapSnapshotResponse> {
    const q = parseFleetMapQuery(rawQuery);
    const zoneMap = await this.zoneByIdMap();

    let allowedZoneIds: string[] | null = null;
    if (q.cities?.length) {
      allowedZoneIds = [...zoneMap.values()]
        .filter((z) => q.cities!.includes(z.city))
        .map((z) => z.zoneId);
    }

    const vehicleFilter: Record<string, unknown> = {
      status: 'active',
      pairedDeviceIds: { $exists: true, $not: { $size: 0 } },
    };
    if (allowedZoneIds && allowedZoneIds.length === 0) {
      return {
        markers: [],
        counts: { moving: 0, idle: 0, offline: 0, syncing: 0 },
        generatedAt: new Date().toISOString(),
        zones: await this.zoneOutlines(),
      };
    }
    const cityFilterZones: GeoZoneDocument[] | null =
      allowedZoneIds && allowedZoneIds.length > 0
        ? allowedZoneIds
            .map((id) => zoneMap.get(id))
            .filter((z): z is GeoZoneDocument => z != null)
        : null;
    if (q.plates?.trim()) {
      vehicleFilter.registrationPlate = new RegExp(
        escapeRegex(q.plates.trim()),
        'i'
      );
    }
    let vehicleRows = await this.vehicles.findMany(vehicleFilter);
    if (q.commercialTiers?.length) {
      vehicleRows = vehicleRows.filter((v) =>
        q.commercialTiers!.includes(v.commercialTier ?? 'other')
      );
    }
    const vehicleById = new Map(vehicleRows.map((v) => [v.vehicleId, v]));
    const vehicleIds = vehicleRows.map((v) => v.vehicleId);
    const deviceRows = await this.devices.findByBoundVehicleIds(vehicleIds);
    const deviceById = new Map(deviceRows.map((d) => [d.deviceId, d]));

    const fleetRows = await this.fleetStatus.findByDeviceIds(
      deviceRows.map((d) => d.deviceId)
    );

    const markers: FleetMapMarker[] = [];
    let moving = 0;
    let idle = 0;
    let offline = 0;
    let syncing = 0;

    for (const fs of fleetRows) {
      const v = vehicleById.get(fs.vehicleId);
      const d = deviceById.get(fs.deviceId);
      if (!v || !d) continue;
      if (v.status === 'decommissioned') continue;

      if (q.deviceName?.trim()) {
        const needle = q.deviceName.trim().toLowerCase();
        const hay = `${d.deviceId} ${d.serialNumber}`.toLowerCase();
        if (!hay.includes(needle)) continue;
      }

      if (q.campaignIds?.length) {
        const cid = fs.playback.currentCampaignId;
        const ok = cid
          ? q.campaignIds.includes(cid)
          : q.campaignIds.includes('__none__');
        if (!ok) continue;
      }

      const state = mapMarkerState(fs, d);
      if (!matchesDeviceStatusFilter(state, q.deviceStatuses)) continue;

      const lat = fs.location.coordinates[1];
      const lng = fs.location.coordinates[0];
      if (
        cityFilterZones &&
        cityFilterZones.length > 0 &&
        !cityFilterZones.some((zone) => isLngLatInZone(zone.geometry, lng, lat))
      ) {
        continue;
      }

      const zoneCity = zoneCityForLngLat(zoneMap, lng, lat);
      const tier = v.commercialTier ?? 'other';

      const marker: FleetMapMarker = {
        deviceId: fs.deviceId,
        vehicleId: fs.vehicleId,
        registrationPlate: v.registrationPlate,
        deviceLabel: d.serialNumber || d.deviceId.slice(0, 8),
        lat,
        lng,
        motionState: state,
        connectivity: fs.connectivity,
        playback: fs.playback,
        commercialTier: tier,
        zoneCity,
        reportedAt: fs.reportedAt.toISOString(),
        lastAccuracyMeters: fs.lastAccuracyMeters ?? null,
      };
      markers.push(marker);

      if (state === 'offline') offline++;
      else if (state === 'moving') moving++;
      else if (state === 'syncing') syncing++;
      else idle++;
    }

    this.logger.debug(
      { markerCount: markers.length, event: 'fleet.map.snapshot' },
      'fleet map snapshot'
    );

    return {
      markers,
      counts: { moving, idle, offline, syncing },
      generatedAt: new Date().toISOString(),
      zones: await this.zoneOutlines(),
    };
  }

  private async zoneOutlines(): Promise<FleetMapZoneOutline[]> {
    const zones = await this.geoZones.findActive();
    return zones.map((z) => ({
      zoneId: z.zoneId,
      name: z.name,
      city: z.city,
      geometry: z.geometry as FleetMapZoneOutline['geometry'],
    }));
  }

  async getDeviceDetail(
    deviceId: string
  ): Promise<FleetMapDeviceDetailResponse> {
    const [d, fs] = await Promise.all([
      this.devices.findByDeviceId(deviceId),
      this.fleetStatus
        .findByDeviceIds([deviceId])
        .then((r) => r[0] ?? null),
    ]);
    if (!d?.boundVehicleId) {
      throw new NotFoundException({ code: 'DEVICE_NOT_BOUND', message: deviceId });
    }
    const v = await this.vehicles.findByVehicleId(d.boundVehicleId);
    if (!v) {
      throw new NotFoundException({ code: 'VEHICLE_NOT_FOUND', message: d.boundVehicleId });
    }
    if (v.status === 'decommissioned') {
      throw new NotFoundException({
        code: 'VEHICLE_DECOMMISSIONED',
        message: d.boundVehicleId,
      });
    }
    if (!fs) {
      throw new NotFoundException({ code: 'FLEET_STATUS_MISSING', message: deviceId });
    }

    const zoneMap = await this.zoneByIdMap();
    const lng = fs.location.coordinates[0];
    const lat = fs.location.coordinates[1];
    const zoneCity = zoneCityForLngLat(zoneMap, lng, lat);
    const state = mapMarkerState(fs, d);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hourlyPlays = await this.impressions.hourlyPlayCountsForDevice(
      deviceId,
      since
    );

    let campaignName: string | null = null;
    let thumbnailUrl: string | null = null;
    let assetId: string | null = null;
    const campaignId = fs.playback.currentCampaignId;
    if (campaignId) {
      const camp = await this.campaigns.findByCampaignId(campaignId);
      campaignName = camp?.name ?? null;
      const asset = await this.creativeAssets.findLatestByCampaignId(campaignId);
      if (asset && asset.mimeType.startsWith('image/')) {
        assetId = asset.assetId;
        const signed = this.assetUrls.buildSignedFileUrl(campaignId, asset.assetId);
        thumbnailUrl = signed.url;
      }
    }

    const storagePct = d.lastHealthMetrics?.storageUtilizationPercent ?? 0;

    return {
      deviceId: d.deviceId,
      vehicleId: v.vehicleId,
      registrationPlate: v.registrationPlate,
      deviceLabel: d.serialNumber || d.deviceId.slice(0, 8),
      serialNumber: d.serialNumber,
      motionState: state,
      location: {
        lat,
        lng,
      },
      lastAccuracyMeters: fs.lastAccuracyMeters ?? null,
      reportedAt: fs.reportedAt.toISOString(),
      connectivity: fs.connectivity,
      playback: fs.playback,
      commercialTier: v.commercialTier ?? 'other',
      zoneCity,
      dataUsagePercent: Math.round(storagePct),
      hourlyPlays,
      currentAd: {
        campaignId,
        campaignName,
        assetId,
        thumbnailUrl,
      },
    };
  }
}
