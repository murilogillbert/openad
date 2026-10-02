import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point, polygon } from '@turf/helpers';

export type SpatialGeometryWire =
  | {
      type: 'Circle';
      center: { lng: number; lat: number };
      radiusMeters: number;
    }
  | {
      type: 'Polygon';
      coordinates: number[][][];
    };

/**
 * True if (lng, lat) lies inside the given circle or polygon geometry (WGS84).
 */
export function isPointInSpatialGeometry(
  lng: number,
  lat: number,
  geometry: SpatialGeometryWire
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
