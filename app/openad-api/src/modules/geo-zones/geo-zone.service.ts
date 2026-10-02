import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PinoLogger } from 'nestjs-pino';
import type { FleetAuditContext } from '../../infrastructure/logging/fleet-audit.context';
import { GeoZonesRepository } from './geo-zones.repository';
import type { CreateGeoZoneDto } from './dto/create-geo-zone.dto';
import type { ListGeoZonesQueryDto } from './dto/list-geo-zones-query.dto';
import type { UpdateGeoZoneDto } from './dto/update-geo-zone.dto';
import type { SpatialBindingDto } from './dto/spatial-binding.dto';
import type { GeoJsonCircle, GeoJsonPolygon, SpatialBinding } from './geo-zone.schema';

@Injectable()
export class GeoZoneService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly zones: GeoZonesRepository
  ) {
    this.logger.setContext(GeoZoneService.name);
  }

  private assertPolygonClosed(coords: number[][][]): void {
    const ring = coords[0];
    if (!ring || ring.length < 4) {
      throw new BadRequestException('Polygon ring must have at least 4 positions');
    }
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) {
      throw new BadRequestException(
        'GeoJSON polygon ring must be closed (first point equals last)'
      );
    }
  }

  private assertCircle(center: { lng: number; lat: number }, radiusMeters: number): void {
    if (radiusMeters <= 0) {
      throw new BadRequestException('radiusMeters must be positive');
    }
    if (
      typeof center?.lng !== 'number' ||
      typeof center?.lat !== 'number' ||
      Number.isNaN(center.lng) ||
      Number.isNaN(center.lat)
    ) {
      throw new BadRequestException('Circle center must have numeric lng and lat');
    }
  }

  private validateBindings(bindings: SpatialBindingDto[] | undefined): void {
    if (!bindings?.length) return;
    for (const b of bindings) {
      if (b.triggerMode === 'dwell' && (b.dwellSeconds == null || b.dwellSeconds <= 0)) {
        throw new BadRequestException(
          'dwellSeconds is required and must be positive when triggerMode is dwell'
        );
      }
    }
  }

  private mapBindings(dto: SpatialBindingDto[] | undefined): SpatialBinding[] {
    if (!dto?.length) return [];
    return dto.map((b) => ({
      mediaId: b.mediaId,
      triggerMode: b.triggerMode,
      dwellSeconds: b.dwellSeconds,
      retriggerCooldownSeconds: b.retriggerCooldownSeconds,
      rotationMode: b.rotationMode,
      velocityMaxKmh: b.velocityMaxKmh,
      velocityMinKmh: b.velocityMinKmh,
      arbitrationWeights: b.arbitrationWeights ?? { wp: 1, wd: 1, wh: 1 },
      pacingFactor: b.pacingFactor ?? 1,
      epicenter: b.epicenter,
    }));
  }

  private normalizeGeometry(
    geometry: CreateGeoZoneDto['geometry']
  ): GeoJsonPolygon | GeoJsonCircle {
    if (geometry.type === 'Polygon') {
      this.assertPolygonClosed(geometry.coordinates);
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates,
      };
    }
    if (geometry.type === 'Circle') {
      this.assertCircle(geometry.center, geometry.radiusMeters);
      return {
        type: 'Circle',
        center: geometry.center,
        radiusMeters: geometry.radiusMeters,
      };
    }
    throw new BadRequestException('geometry.type must be Polygon or Circle');
  }

  async create(
    dto: CreateGeoZoneDto,
    audit: FleetAuditContext,
    createdBy: string | null
  ) {
    this.validateBindings(dto.bindings);
    const geometry = this.normalizeGeometry(dto.geometry);

    const zoneId = randomUUID();
    this.logger.info(
      { ...audit, event: 'geo_zone.create.attempt', zoneId },
      'create geo zone'
    );

    const doc = await this.zones.create({
      zoneId,
      name: dto.name,
      description: dto.description,
      city: dto.city,
      geometry,
      tags: dto.tags ?? [],
      createdBy,
      tier: dto.tier ?? 'T4',
      priorityScore: dto.priorityScore ?? 0,
      bufferExitMeters: dto.bufferExitMeters ?? 20,
      isActive: dto.isActive ?? true,
      bindings: this.mapBindings(dto.bindings),
    });

    this.logger.info(
      { ...audit, event: 'geo_zone.create.success', zoneId },
      'geo zone created'
    );

    return this.toResponse(doc);
  }

  async update(zoneId: string, dto: UpdateGeoZoneDto, audit: FleetAuditContext) {
    const existing = await this.zones.findByZoneId(zoneId);
    if (!existing) {
      throw new NotFoundException({ success: false, error: { code: 'GEO_ZONE_NOT_FOUND' } });
    }
    this.validateBindings(dto.bindings);
    this.logger.info({ ...audit, event: 'geo_zone.update.attempt', zoneId }, 'update geo zone');

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch['name'] = dto.name;
    if (dto.description !== undefined) patch['description'] = dto.description;
    if (dto.city !== undefined) patch['city'] = dto.city;
    if (dto.tags !== undefined) patch['tags'] = dto.tags;
    if (dto.tier !== undefined) patch['tier'] = dto.tier;
    if (dto.priorityScore !== undefined) patch['priorityScore'] = dto.priorityScore;
    if (dto.bufferExitMeters !== undefined) patch['bufferExitMeters'] = dto.bufferExitMeters;
    if (dto.isActive !== undefined) patch['isActive'] = dto.isActive;
    if (dto.geometry !== undefined) {
      patch['geometry'] = this.normalizeGeometry(dto.geometry);
    }
    if (dto.bindings !== undefined) {
      patch['bindings'] = this.mapBindings(dto.bindings);
    }

    const doc = await this.zones.updateOne({ zoneId }, { $set: patch });
    if (!doc) {
      throw new NotFoundException({ success: false, error: { code: 'GEO_ZONE_NOT_FOUND' } });
    }

    this.logger.info({ ...audit, event: 'geo_zone.update.success', zoneId }, 'geo zone updated');
    return this.toResponse(doc);
  }

  async findAll(query: ListGeoZonesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const filter: Record<string, unknown> = {};
    if (query.city) filter['city'] = query.city;
    if (query.tag) filter['tags'] = query.tag;
    if (query.tier) filter['tier'] = query.tier;
    if (query.isActive !== undefined) filter['isActive'] = query.isActive;
    if (query.geometryType) {
      filter['geometry.type'] = query.geometryType;
    }

    const total = await this.zones.countDocuments(filter);
    const skip = (page - 1) * limit;
    const rows = await this.zones.findMany(filter, {
      skip,
      limit,
      sort: { updatedAt: -1 },
    });

    return {
      data: rows.map((d) => this.toResponse(d)),
      pagination: { total, page, limit },
    };
  }

  private toResponse(doc: {
    zoneId: string;
    name: string;
    description: string;
    city: string;
    geometry: GeoJsonPolygon | GeoJsonCircle;
    tags: string[];
    tier?: 'T1' | 'T2' | 'T3' | 'T4';
    priorityScore?: number;
    bufferExitMeters?: number;
    isActive?: boolean;
    bindings?: SpatialBinding[];
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      zoneId: doc.zoneId,
      name: doc.name,
      description: doc.description,
      city: doc.city,
      geometry: doc.geometry,
      tags: doc.tags,
      tier: doc.tier ?? 'T4',
      priorityScore: doc.priorityScore ?? 0,
      bufferExitMeters: doc.bufferExitMeters ?? 20,
      isActive: doc.isActive !== false,
      bindings: doc.bindings ?? [],
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }
}
