import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import buffer from '@turf/buffer';
import distance from '@turf/distance';
import { point, polygon } from '@turf/helpers';
import type { SpatialGeometryContract } from '@openad/api-contracts';

export function isPointInSpatialGeometry(
  lng: number,
  lat: number,
  geometry: SpatialGeometryContract
): boolean {
  if (geometry.type === 'Circle') {
    const distM = distance(
      point([lng, lat]),
      point([geometry.center.lng, geometry.center.lat]),
      { units: 'meters' }
    );
    return distM <= geometry.radiusMeters;
  }
  const poly = polygon(geometry.coordinates);
  return booleanPointInPolygon(point([lng, lat]), poly);
}

/**
 * True while the point remains “in play” for exit purposes: nominal geometry
 * expanded outward by `bufferMeters` (hysteresis / exit buffer, FR-010).
 * When `bufferMeters <= 0`, same as {@link isPointInSpatialGeometry}.
 */
export function withinExpandedGeometry(
  lng: number,
  lat: number,
  geometry: SpatialGeometryContract,
  bufferMeters: number
): boolean {
  if (bufferMeters <= 0) {
    return isPointInSpatialGeometry(lng, lat, geometry);
  }
  if (geometry.type === 'Circle') {
    const distM = distance(
      point([lng, lat]),
      point([geometry.center.lng, geometry.center.lat]),
      { units: 'meters' }
    );
    return distM <= geometry.radiusMeters + bufferMeters;
  }
  const polyFeat = polygon(geometry.coordinates);
  const buffered = buffer(polyFeat, bufferMeters, { units: 'meters' });
  if (buffered == null) {
    return isPointInSpatialGeometry(lng, lat, geometry);
  }
  return booleanPointInPolygon(point([lng, lat]), buffered);
}
