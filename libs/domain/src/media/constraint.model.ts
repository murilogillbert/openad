/** GeoJSON polygon for geofence targeting (004). */
export interface GeofencePolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface TimeWindowConstraint {
  startHour: number;
  endHour: number;
}

export interface SpeedRangeConstraint {
  minKmh: number;
  maxKmh: number;
}

export interface ConstraintBundle {
  geofence?: GeofencePolygon;
  timeWindows?: TimeWindowConstraint[];
  speedRange?: SpeedRangeConstraint;
}
