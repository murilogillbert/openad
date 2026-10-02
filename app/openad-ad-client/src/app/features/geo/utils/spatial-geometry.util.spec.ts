import { describe, it, expect } from 'vitest';
import {
  isPointInSpatialGeometry,
  withinExpandedGeometry,
} from './spatial-geometry.util';

describe('spatial-geometry.util', () => {
  const square = {
    type: 'Polygon' as const,
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

  it('expanded polygon includes points just outside nominal within buffer', () => {
    expect(isPointInSpatialGeometry(0.5, 0.5, square)).toBe(true);
    expect(isPointInSpatialGeometry(0, 1.0002, square)).toBe(false);
    const buf = 50_000;
    expect(withinExpandedGeometry(0, 1.0002, square, buf)).toBe(true);
  });

  it('expanded circle matches radius + buffer', () => {
    const circle = {
      type: 'Circle' as const,
      center: { lng: 0, lat: 0 },
      radiusMeters: 100,
    };
    expect(withinExpandedGeometry(0, 0.0005, circle, 50)).toBe(true);
  });
});
