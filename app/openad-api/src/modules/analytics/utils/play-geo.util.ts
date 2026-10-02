import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import distance from '@turf/distance';
import { point, polygon as turfPolygon } from '@turf/helpers';
import type { GeoJsonCircle, GeoJsonPolygon } from '../../geo-zones/geo-zone.schema';

/** WGS84 point inside zone geometry (Polygon or Circle). */
export function isLngLatInZone(
  geometry: GeoJsonPolygon | GeoJsonCircle,
  lng: number,
  lat: number
): boolean {
  if (geometry.type === 'Polygon') {
    const outer = geometry.coordinates[0];
    if (!outer?.length) {
      return false;
    }
    const closed =
      outer[0]![0] === outer[outer.length - 1]![0] &&
      outer[0]![1] === outer[outer.length - 1]![1]
        ? outer
        : [...outer, outer[0]!];
    const poly = turfPolygon([closed]);
    return booleanPointInPolygon(point([lng, lat]), poly);
  }
  const km = distance(
    point([lng, lat]),
    point([geometry.center.lng, geometry.center.lat]),
    { units: 'kilometers' }
  );
  return km * 1000 <= geometry.radiusMeters;
}
