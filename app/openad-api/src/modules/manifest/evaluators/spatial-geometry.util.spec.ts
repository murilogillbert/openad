import { isPointInSpatialGeometry } from './spatial-geometry.util';

describe('spatial-geometry.util', () => {
  const square: {
    type: 'Polygon';
    coordinates: number[][][];
  } = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
    ],
  };

  it('detects point inside polygon', () => {
    expect(isPointInSpatialGeometry(0.5, 0.5, square)).toBe(true);
    expect(isPointInSpatialGeometry(5, 5, square)).toBe(false);
  });

  it('detects point inside circle', () => {
    const circle = {
      type: 'Circle' as const,
      center: { lng: 0, lat: 0 },
      radiusMeters: 100_000,
    };
    expect(isPointInSpatialGeometry(0.1, 0.1, circle)).toBe(true);
  });
});
